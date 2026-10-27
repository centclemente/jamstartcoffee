import itertools
import json
import logging
import os
import warnings
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from prophet import Prophet
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.statespace.sarimax import SARIMAX

try:
    from .category_contribution import compute_category_contribution, generate_category_insight
except ImportError:
    from category_contribution import compute_category_contribution, generate_category_insight

# Silence Prophet/cmdstanpy's verbose "Log joint probability" console spam
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
logging.getLogger("prophet").setLevel(logging.WARNING)
# statsmodels throws a lot of convergence/frequency warnings during grid search -- expected, safe to ignore
warnings.filterwarnings("ignore")

load_dotenv(Path(__file__).parent / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Check your .env file.")

app = FastAPI(title="Jamstart Coffee - Sales Forecasting Service")

MIN_MONTHS_REQUIRED = 6  # Prophet/ARIMA/SARIMA need a reasonable history to be useful

# ---------------------------------------------------------------------------
# PRE-TRAINED HOLT-WINTERS MODELS (client-supplied)
# ---------------------------------------------------------------------------
# These are already-fitted statsmodels ExponentialSmoothing results. They are
# loaded once and forecast from their own training index. The "sarima" key is
# retained as a compatibility alias for the existing sales forecast client.
MODEL_DIR = Path(__file__).parent / "model"

PRETRAINED_MODEL_META = {
    "sarima": {
        "file": MODEL_DIR / "sales_holtwinters_model.pkl",
        "target": "revenue",
        "model_type": "holt_winters",
    },
    "demand": {
        "file": MODEL_DIR / "demand_holtwinters_model.pkl",
        "target": "units",
        "model_type": "holt_winters",
    },
}


@lru_cache(maxsize=None)
def load_pretrained_model(key: str):
    """Load a client-supplied Holt-Winters model once per process."""
    if key not in PRETRAINED_MODEL_META:
        raise KeyError(f"Unknown pretrained model key '{key}'. Valid keys: {list(PRETRAINED_MODEL_META)}")
    path = PRETRAINED_MODEL_META[key]["file"]
    if not path.exists():
        raise FileNotFoundError(
            f"Expected pretrained model file at {path}, but it doesn't exist. "
            f"Did you copy the .pkl the client sent into the models/ folder?"
        )
    return joblib.load(path)


def _last_model_month(model) -> pd.Timestamp:
    """Read the final fitted month from a statsmodels results object's index."""
    candidates = [
        getattr(getattr(model, "model", None), "data", None),
        getattr(model, "data", None),
    ]
    for data in candidates:
        dates = getattr(data, "dates", None)
        if dates is not None and len(dates):
            return pd.Timestamp(dates[-1]).to_period("M").to_timestamp()
        index = getattr(data, "row_labels", None)
        if index is not None and len(index):
            return pd.Timestamp(index[-1]).to_period("M").to_timestamp()
    raise ValueError("The Holt-Winters model does not contain a usable training date index.")


def _model_training_start(model) -> pd.Timestamp:
    """Read the first fitted month from a statsmodels results object's index."""
    data = getattr(getattr(model, "model", None), "data", None)
    index = getattr(data, "row_labels", None)
    if index is None or not len(index):
        raise ValueError("The Holt-Winters model does not contain a training date index.")
    return pd.Timestamp(index[0]).to_period("M").to_timestamp()


def _holt_winters_prediction_intervals(model, predicted: np.ndarray) -> np.ndarray:
    """Build approximate 95% intervals from the fitted residual variation."""
    residuals = np.asarray(getattr(model, "resid", []), dtype=float)
    residuals = residuals[np.isfinite(residuals)]
    residual_std = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else 0.0
    margin = 1.96 * residual_std
    return np.column_stack((predicted - margin, predicted + margin))


def run_pretrained_forecast(key: str, months_ahead: int, history_months: int = 6) -> dict:
    """
    Forecasts using a client-supplied pre-trained Holt-Winters model instead of
    fitting a new one. Returns both "history" (actual monthly units from
    the Sale table, up through the last imported month) and "forecast"
    (predicted months after that), so the frontend can draw history as a
    solid line and the forecast as a dashed/broken line continuing from it
    -- same pattern as /forecast/sales.

    The model is frozen at its embedded training cutoff and always predicts
    sequentially from there. The forecast should pick up right
    after the last actual month you've imported (fetch_last_actual_month()),
    NOT from today's calendar date and NOT from the model's own training
    cutoff -- those are almost never the same month. We predict far enough
    ahead to cover that gap, then drop the already-elapsed months and only
    return the next `months_ahead` months counting from your latest import.
    """
    model = load_pretrained_model(key)
    meta = PRETRAINED_MODEL_META[key]
    training_start = _model_training_start(model)
    last_known_date = _last_model_month(model)

    last_actual_month = fetch_last_actual_month()
    if last_actual_month is None:
        last_actual_month = pd.Timestamp(date.today().replace(day=1))

    elapsed_months = (
        (last_actual_month.year - last_known_date.year) * 12
        + (last_actual_month.month - last_known_date.month)
    )
    elapsed_months = max(elapsed_months, 0)

    total_periods = elapsed_months + months_ahead
    forecast_method = getattr(model, "forecast", None)
    if not callable(forecast_method):
        raise TypeError("The configured pretrained model must provide a forecast(steps) method.")
    predicted = np.asarray(forecast_method(steps=total_periods), dtype=float)
    if len(predicted) != total_periods:
        raise ValueError(
            f"The pretrained model returned {len(predicted)} predictions; expected {total_periods}."
        )
    conf_int = _holt_winters_prediction_intervals(model, predicted)

    sales_df = fetch_monthly_sales()

    comparison = []
    target_field = "total_revenue" if meta["target"] == "revenue" else "total_units"
    evaluated_errors = []
    evaluated_percentage_errors = []
    for row in sales_df.itertuples():
        actual_date = pd.to_datetime(row.month, format="%Y-%m")
        prediction_index = (
            (actual_date.year - last_known_date.year) * 12
            + (actual_date.month - last_known_date.month)
            - 1
        )
        # The model was trained through last_known_date, so only compare
        # predictions for later completed months. Never score in-sample data.
        if prediction_index < 0 or prediction_index >= elapsed_months:
            continue

        actual_value = float(getattr(row, target_field))
        predicted_value = max(float(predicted[prediction_index]), 0)
        error = actual_value - predicted_value
        absolute_error = abs(error)
        evaluated_errors.append(error)
        if actual_value != 0:
            evaluated_percentage_errors.append(absolute_error / abs(actual_value) * 100)

        comparison.append({
            "month": row.month,
            "actualValue": round(actual_value, 2),
            "predictedValue": round(max(predicted_value, 0), 2),
            "errorAmount": round(error, 2),
            "errorPct": round(error / actual_value * 100, 2) if actual_value != 0 else None,
            "accuracyPct": round(max(0, 100 - (absolute_error / abs(actual_value) * 100)), 2)
            if actual_value != 0 else None,
        })

    forecast = []
    for i in range(elapsed_months, total_periods):
        future_date = last_known_date + pd.DateOffset(months=i + 1)
        forecast.append({
            "month": future_date.strftime("%Y-%m"),
            "predictedValue": round(max(float(predicted[i]), 0)),
            "lowerBound": round(max(float(conf_int[i, 0]), 0)),
            "upperBound": round(max(float(conf_int[i, 1]), 0)),
        })

    history = [
        {
            "month": row.month,
            "actualUnits": int(row.total_units),
            "actualRevenue": round(float(row.total_revenue), 2),
        }
        for row in sales_df.itertuples()
    ]

    category_history = fetch_monthly_category_sales()
    forecast_frame = pd.DataFrame(forecast)
    category_contribution = compute_category_contribution(
        category_history,
        forecast_frame,
        meta["target"],
    )
    category_insight = generate_category_insight(
        json.dumps(category_contribution, sort_keys=True, separators=(",", ":")),
        meta["target"],
    )

    return {
        "history": history,
        "forecast": forecast,
        "comparison": comparison,
        "accuracy": {
            "evaluatedMonths": len(comparison),
            "mae": round(float(np.mean(np.abs(evaluated_errors))), 2) if evaluated_errors else None,
            "rmse": round(float(np.sqrt(np.mean(np.square(evaluated_errors)))), 2)
            if evaluated_errors else None,
            "mape": round(float(np.mean(evaluated_percentage_errors)), 2)
            if evaluated_percentage_errors else None,
        },
        "model": {
            "type": meta["model_type"],
            "trainingStart": training_start.strftime("%Y-%m"),
            "trainingEnd": last_known_date.strftime("%Y-%m"),
            "forecastStart": forecast[0]["month"] if forecast else None,
        },
        "category_contribution": category_contribution,
        "category_insight": category_insight,
    }


def update_pretrained_model(key: str, new_values: list[float]):
    """
    Holt-Winters results are frozen artifacts and do not support the previous
    update path. Retraining should produce a new model file.
    """
    raise NotImplementedError("Holt-Winters pretrained models must be replaced after retraining.")
# ---------------------------------------------------------------------------


def fetch_last_actual_month() -> Optional[pd.Timestamp]:
    """
    Returns the first day of the most recent month present in the Sale
    table (e.g. if the latest imported row is dated 2026-06-15, returns
    2026-06-01). Used so pretrained forecasts start right after your real
    data ends, instead of starting from today's calendar date or from the
    model's frozen training cutoff.
    """
    conn = get_connection()
    try:
        df = pd.read_sql(
            'SELECT to_char(date_trunc(\'month\', MAX(date)), \'YYYY-MM\') AS last_month FROM "Sale" WHERE "archivedAt" IS NULL',
            conn,
        )
        last_month = df["last_month"].iloc[0]
        if not last_month:
            return None
        return pd.to_datetime(last_month, format="%Y-%m")
    finally:
        conn.close()


def get_connection():
    return psycopg2.connect(DATABASE_URL)


def fetch_monthly_sales(category: Optional[str] = None, item_name: Optional[str] = None) -> pd.DataFrame:
    """Pulls monthly aggregated revenue from the Sale table."""
    conn = get_connection()
    try:
        query = """
            SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month,
                   SUM("totalSales")::float AS total_revenue,
                   SUM(items_sold)::int AS total_units
            FROM "Sale"
            WHERE "archivedAt" IS NULL
        """
        params = []

        if category:
            query += ' AND category = %s'
            params.append(category)

        if item_name:
            query += ' AND item_name = %s'
            params.append(item_name)

        query += " GROUP BY date_trunc('month', date) ORDER BY date_trunc('month', date) ASC"

        df = pd.read_sql(query, conn, params=params)
        return df
    finally:
        conn.close()


def fetch_monthly_category_sales() -> pd.DataFrame:
    """Pull monthly category totals for contribution estimates only."""
    conn = get_connection()
    try:
        query = """
            SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month,
                   category,
                   SUM("totalSales")::float AS total_revenue,
                   SUM(items_sold)::int AS total_units
            FROM "Sale"
            WHERE "archivedAt" IS NULL
            GROUP BY date_trunc('month', date), category
            ORDER BY date_trunc('month', date) ASC, category ASC
        """
        return pd.read_sql(query, conn)
    finally:
        conn.close()


def run_prophet_forecast(df: pd.DataFrame, months_ahead: int) -> pd.DataFrame:
    prophet_df = df.rename(columns={"month": "ds", "total_revenue": "y"})[["ds", "y"]]
    prophet_df["ds"] = pd.to_datetime(prophet_df["ds"], format="%Y-%m")

    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=False,
        daily_seasonality=False,
        uncertainty_samples=200,
    )
    model.fit(prophet_df, iter=300)

    future = model.make_future_dataframe(periods=months_ahead, freq="MS")
    forecast = model.predict(future)

    return forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]].tail(months_ahead)


def interpret_accuracy(mae: float, rmse: float, mape: Optional[float]) -> dict:
    """
    Translates raw backtest metrics into a plain verdict.

    Ideal ranges:
      - MAPE: <=10% excellent, 10-20% acceptable, >20% poor
      - MAE:  <=5000 good, otherwise high (revenue scale)
      - RMSE: should stay close to MAE; a big gap (ratio > 1.5) means
              a few months had much bigger misses than the rest (outliers)
    """
    if mape is None:
        mape_verdict = "n/a"
    elif mape <= 10:
        mape_verdict = "excellent"
    elif mape <= 20:
        mape_verdict = "acceptable"
    else:
        mape_verdict = "poor"

    mae_verdict = "good" if mae <= 5000 else "high"

    if mae == 0:
        rmse_verdict = "n/a"
    else:
        ratio = rmse / mae
        rmse_verdict = "consistent" if ratio <= 1.5 else "inconsistent (possible outlier months)"

    return {
        "mape": mape_verdict,
        "mae": mae_verdict,
        "rmse": rmse_verdict,
    }


def compare_models(results_by_model: dict) -> dict:
    """
    Picks the best-performing model out of however many are passed in
    (e.g. {"prophet": {...}, "arima": {...}, "sarima": {...}}).

    Primary tiebreaker is MAPE (lower is better) since it's scale-independent
    and the most directly interpretable ("on average, X% off"). Falls back to
    MAE, then RMSE, if MAPE is missing or tied across the leading candidates.
    """
    def sort_key(item):
        name, result = item
        mape = result["mape"] if result["mape"] is not None else float("inf")
        mae = result["mae"]
        rmse = result["rmse"]
        return (mape, mae, rmse)

    ranked = sorted(results_by_model.items(), key=sort_key)
    winner_name, winner_result = ranked[0]

    if winner_result["mape"] is not None:
        reason = "lowest MAPE"
    elif winner_result["mae"] is not None:
        reason = "lowest MAE (MAPE unavailable)"
    else:
        reason = "lowest RMSE (MAPE and MAE unavailable)"

    return {
        "winner": winner_name,
        "reason": reason,
        "ranking": [name for name, _ in ranked],
    }


def find_best_arima_order(
    series: pd.Series,
    p_range=range(0, 3),
    d_range=range(0, 2),
    q_range=range(0, 3),
):
    """
    Small grid search over (p, d, q) combinations, scored by AIC (lower is
    better -- balances fit quality against model complexity).
    """
    best_aic = np.inf
    best_order = (1, 1, 1)  # sane fallback if every combination fails to converge

    for p, d, q in itertools.product(p_range, d_range, q_range):
        try:
            fitted = ARIMA(series, order=(p, d, q)).fit()
            if fitted.aic < best_aic:
                best_aic = fitted.aic
                best_order = (p, d, q)
        except Exception:
            continue  # some combos won't converge on short series -- skip them

    return best_order


def find_best_sarima_order(
    series: pd.Series,
    p_range=range(0, 2),
    d_range=range(0, 2),
    q_range=range(0, 2),
    seasonal_p_range=range(0, 2),
    seasonal_d_range=range(0, 2),
    seasonal_q_range=range(0, 2),
    seasonal_period=12,
):
    """
    Grid search over both non-seasonal (p,d,q) and seasonal (P,D,Q,s) terms,
    scored by AIC. Kept narrower than the plain ARIMA search (0-1 instead of
    0-2 per term) since the seasonal search space grows fast -- 2x2x2 seasonal
    x 2x2x2 non-seasonal is already 64 fits per call, and Prophet-scale
    data (~40 monthly points) doesn't need a wider search to find a good fit.
    """
    best_aic = np.inf
    best_order = (1, 1, 1)
    best_seasonal_order = (1, 1, 1, seasonal_period)

    for p, d, q in itertools.product(p_range, d_range, q_range):
        for sp, sd, sq in itertools.product(seasonal_p_range, seasonal_d_range, seasonal_q_range):
            try:
                fitted = SARIMAX(
                    series,
                    order=(p, d, q),
                    seasonal_order=(sp, sd, sq, seasonal_period),
                    enforce_stationarity=False,
                    enforce_invertibility=False,
                ).fit(disp=False)
                if fitted.aic < best_aic:
                    best_aic = fitted.aic
                    best_order = (p, d, q)
                    best_seasonal_order = (sp, sd, sq, seasonal_period)
            except Exception:
                continue

    return best_order, best_seasonal_order


def run_backtest_arima(df: pd.DataFrame, holdout_months: int) -> dict:
    """ARIMA equivalent of run_backtest() -- same train/holdout split on revenue."""
    series_df = df.copy()
    series_df["ds"] = pd.to_datetime(series_df["month"], format="%Y-%m")
    series_df = series_df.set_index("ds")["total_revenue"]
    series_df.index.freq = "MS"

    train_series = series_df.iloc[:-holdout_months]
    test_series = series_df.iloc[-holdout_months:]

    order = find_best_arima_order(train_series)
    model = ARIMA(train_series, order=order).fit()
    predicted_values = model.forecast(steps=holdout_months).values

    actual = test_series.values
    errors = actual - predicted_values
    abs_errors = np.abs(errors)

    mae = float(np.mean(abs_errors))
    rmse = float(np.sqrt(np.mean(errors ** 2)))
    mape = float(np.mean(np.abs(errors / np.where(actual == 0, np.nan, actual))) * 100)

    comparison = [
        {
            "month": test_series.index[i].strftime("%Y-%m"),
            "actualRevenue": round(float(actual[i]), 2),
            "predictedRevenue": round(float(predicted_values[i]), 2),
            "errorAmount": round(float(errors[i]), 2),
            "errorPct": round(float(errors[i] / actual[i] * 100), 2) if actual[i] != 0 else None,
        }
        for i in range(holdout_months)
    ]

    return {
        "order": order,
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mape": round(mape, 2) if not np.isnan(mape) else None,
        "comparison": comparison,
    }


def run_backtest_sarima(df: pd.DataFrame, holdout_months: int) -> dict:
    """
    SARIMA equivalent of run_backtest() -- adds seasonal (P,D,Q,12) terms on
    top of ARIMA's (p,d,q), which should help on data like this with clear
    yearly seasonality (holiday peaks, Jan-Mar dips).
    """
    series_df = df.copy()
    series_df["ds"] = pd.to_datetime(series_df["month"], format="%Y-%m")
    series_df = series_df.set_index("ds")["total_revenue"]
    series_df.index.freq = "MS"

    train_series = series_df.iloc[:-holdout_months]
    test_series = series_df.iloc[-holdout_months:]

    order, seasonal_order = find_best_sarima_order(train_series)
    model = SARIMAX(
        train_series,
        order=order,
        seasonal_order=seasonal_order,
        enforce_stationarity=False,
        enforce_invertibility=False,
    ).fit(disp=False)
    predicted_values = model.forecast(steps=holdout_months).values

    actual = test_series.values
    errors = actual - predicted_values
    abs_errors = np.abs(errors)

    mae = float(np.mean(abs_errors))
    rmse = float(np.sqrt(np.mean(errors ** 2)))
    mape = float(np.mean(np.abs(errors / np.where(actual == 0, np.nan, actual))) * 100)

    comparison = [
        {
            "month": test_series.index[i].strftime("%Y-%m"),
            "actualRevenue": round(float(actual[i]), 2),
            "predictedRevenue": round(float(predicted_values[i]), 2),
            "errorAmount": round(float(errors[i]), 2),
            "errorPct": round(float(errors[i] / actual[i] * 100), 2) if actual[i] != 0 else None,
        }
        for i in range(holdout_months)
    ]

    return {
        "order": order,
        "seasonalOrder": seasonal_order,
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mape": round(mape, 2) if not np.isnan(mape) else None,
        "comparison": comparison,
    }


def run_backtest(df: pd.DataFrame, holdout_months: int) -> dict:
    """
    Trains Prophet on all data EXCEPT the last `holdout_months`,
    predicts those held-out months, then compares predictions to
    what actually happened.
    """
    prophet_df = df.rename(columns={"month": "ds", "total_revenue": "y"})[["ds", "y"]]
    prophet_df["ds"] = pd.to_datetime(prophet_df["ds"], format="%Y-%m")

    train_df = prophet_df.iloc[:-holdout_months]
    test_df = prophet_df.iloc[-holdout_months:].reset_index(drop=True)

    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=False,
        daily_seasonality=False,
    )
    model.fit(train_df)

    future = model.make_future_dataframe(periods=holdout_months, freq="MS")
    forecast = model.predict(future)
    predicted = forecast[["ds", "yhat"]].tail(holdout_months).reset_index(drop=True)

    actual = test_df["y"].values
    predicted_values = predicted["yhat"].values

    errors = actual - predicted_values
    abs_errors = np.abs(errors)

    mae = float(np.mean(abs_errors))
    rmse = float(np.sqrt(np.mean(errors ** 2)))
    mape = float(np.mean(np.abs(errors / np.where(actual == 0, np.nan, actual))) * 100)

    comparison = [
        {
            "month": test_df["ds"].iloc[i].strftime("%Y-%m"),
            "actualRevenue": round(float(actual[i]), 2),
            "predictedRevenue": round(float(predicted_values[i]), 2),
            "errorAmount": round(float(errors[i]), 2),
            "errorPct": round(float(errors[i] / actual[i] * 100), 2) if actual[i] != 0 else None,
        }
        for i in range(holdout_months)
    ]

    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mape": round(mape, 2) if not np.isnan(mape) else None,
        "comparison": comparison,
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "time": datetime.utcnow().isoformat(),
        "version": "v8-holt-winters-pretrained",
    }


@app.get("/forecast/sales")
def forecast_sales(
    months_ahead: int = Query(3, ge=1, le=24, description="How many months to forecast"),
    category: Optional[str] = Query(None, description="Filter by category"),
    item_name: Optional[str] = Query(None, description="Filter by item name"),
):
    try:
        df = fetch_monthly_sales(category=category, item_name=item_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    if df.empty or len(df) < MIN_MONTHS_REQUIRED:
        return {
            "error": f"Not enough historical data to forecast. Need at least {MIN_MONTHS_REQUIRED} months, found {len(df)}.",
            "category": category,
            "item_name": item_name,
        }

    try:
        result = run_prophet_forecast(df, months_ahead)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecasting error: {str(e)}")

    history = [
        {
            "month": row.month,
            "actualRevenue": round(row.total_revenue, 2),
            "actualUnits": int(row.total_units),
        }
        for row in df.itertuples()
    ]

    forecast = [
        {
            "month": row.ds.strftime("%Y-%m"),
            "predictedRevenue": round(max(row.yhat, 0), 2),
            "lowerBound": round(max(row.yhat_lower, 0), 2),
            "upperBound": round(max(row.yhat_upper, 0), 2),
        }
        for row in result.itertuples()
    ]

    return {
        "category": category,
        "item_name": item_name,
        "monthsAhead": months_ahead,
        "history": history,
        "forecast": forecast,
    }


@app.get("/forecast/backtest")
def backtest_sales(
    holdout_months: int = Query(3, ge=1, le=12, description="How many recent months to hold out and test against"),
    category: Optional[str] = Query(None, description="Filter by category"),
    item_name: Optional[str] = Query(None, description="Filter by item name"),
):
    """
    General sales backtest -- revenue-based, whole-store (or filtered by
    category/item_name if given). Runs Prophet, ARIMA, and SARIMA, and
    returns a bestModel verdict comparing all three on MAPE/MAE/RMSE.
    """
    try:
        df = fetch_monthly_sales(category=category, item_name=item_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    min_required = MIN_MONTHS_REQUIRED + holdout_months
    if df.empty or len(df) < min_required:
        return {
            "error": f"Not enough historical data to backtest. Need at least {min_required} months "
                     f"({MIN_MONTHS_REQUIRED} to train + {holdout_months} to hold out), found {len(df)}.",
            "category": category,
            "item_name": item_name,
        }

    try:
        prophet_result = run_backtest(df, holdout_months)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prophet backtest error: {str(e)}")

    try:
        arima_result = run_backtest_arima(df, holdout_months)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ARIMA backtest error: {str(e)}")

    try:
        sarima_result = run_backtest_sarima(df, holdout_months)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SARIMA backtest error: {str(e)}")

    best = compare_models({
        "prophet": prophet_result,
        "arima": arima_result,
        "sarima": sarima_result,
    })

    return {
        "category": category,
        "item_name": item_name,
        "holdoutMonths": holdout_months,
        "prophet": {
            "accuracy": {
                "mae": prophet_result["mae"],
                "rmse": prophet_result["rmse"],
                "mape": prophet_result["mape"],
            },
            "verdict": interpret_accuracy(prophet_result["mae"], prophet_result["rmse"], prophet_result["mape"]),
            "monthByMonth": prophet_result["comparison"],
        },
        "arima": {
            "order": arima_result["order"],
            "accuracy": {
                "mae": arima_result["mae"],
                "rmse": arima_result["rmse"],
                "mape": arima_result["mape"],
            },
            "verdict": interpret_accuracy(arima_result["mae"], arima_result["rmse"], arima_result["mape"]),
            "monthByMonth": arima_result["comparison"],
        },
        "sarima": {
            "order": sarima_result["order"],
            "seasonalOrder": sarima_result["seasonalOrder"],
            "accuracy": {
                "mae": sarima_result["mae"],
                "rmse": sarima_result["rmse"],
                "mape": sarima_result["mape"],
            },
            "verdict": interpret_accuracy(sarima_result["mae"], sarima_result["rmse"], sarima_result["mape"]),
            "monthByMonth": sarima_result["comparison"],
        },
        "bestModel": best,
    }


@app.get("/forecast/categories")
def list_categories():
    """Helper endpoint so the frontend can populate a category dropdown for /forecast/sales."""
    conn = get_connection()
    try:
        df = pd.read_sql('SELECT DISTINCT category FROM "Sale" WHERE "archivedAt" IS NULL ORDER BY category ASC', conn)
        return {"categories": df["category"].tolist()}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Endpoints serving the client's pre-trained Holt-Winters models
# ---------------------------------------------------------------------------
@app.get("/forecast/pretrained/{key}")
def forecast_pretrained(
    key: str,
    months_ahead: int = Query(3, ge=1, le=24, description="How many months to forecast"),
    history_months: int = Query(6, ge=6, le=24, description="How many recent months to use as the forecast basis"),
):
    """
    Serves forecasts from the client's pre-trained Holt-Winters models
    instead of fitting a new model on request. The "sarima" key is retained
    for API compatibility and maps to the sales model.
    """
    if key not in PRETRAINED_MODEL_META:
        raise HTTPException(
            status_code=404,
            detail=f"No pretrained model for '{key}'. Valid keys: {list(PRETRAINED_MODEL_META)}",
        )
    try:
        result = run_pretrained_forecast(key, months_ahead, history_months)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pretrained forecast error: {str(e)}")

    return {
        "key": key,
        "target": PRETRAINED_MODEL_META[key]["target"],
        "model": result["model"],
        "monthsAhead": months_ahead,
        "historyMonths": history_months,
        "history": result["history"],
        "forecast": result["forecast"],
        "comparison": result["comparison"],
        "accuracy": result["accuracy"],
        "category_contribution": result["category_contribution"],
        "category_insight": result["category_insight"],
    }
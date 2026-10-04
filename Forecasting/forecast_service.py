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

from category_contribution import compute_category_contribution, generate_category_insight

# Silence Prophet/cmdstanpy's verbose "Log joint probability" console spam
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
logging.getLogger("prophet").setLevel(logging.WARNING)
# statsmodels throws a lot of convergence/frequency warnings during grid search -- expected, safe to ignore
warnings.filterwarnings("ignore")

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Check your .env file.")

app = FastAPI(title="Jamstart Coffee - Sales Forecasting Service")

MIN_MONTHS_REQUIRED = 6  # Prophet/ARIMA/SARIMA need a reasonable history to be useful

# ---------------------------------------------------------------------------
# PRE-TRAINED PMDARIMA MODELS (client-supplied)
# ---------------------------------------------------------------------------
# These are ALREADY-FITTED pmdarima.ARIMA objects the client sent you --
# NOT something this service trains. That's a different code path from
# find_best_sarima_order()/SARIMAX below, which fits a fresh statsmodels
# model from scratch on every request. Here you load once and call .predict().
#
# STEP 1: pip install pmdarima==2.1.1 joblib --break-system-packages
#         (version pin matters -- both files were pickled with pmdarima 2.1.1)
#
# STEP 2: put the two files the client sent you here:
#           <project_root>/models/sarima_model.pkl
#           <project_root>/models/demand_sarima_model.pkl
#
# STEP 3: fill in PRETRAINED_MODEL_META below once you know from the client
#         what series each model was trained on (whole store? one category?
#         which one?) and the last month of data used to train it. Without
#         the correct last_trained_month, forecasted months will be labeled
#         wrong even though the numbers themselves are fine.
MODEL_DIR = Path(__file__).parent / "model"

PRETRAINED_MODEL_META = {
    "sarima": {
        "file": MODEL_DIR / "sarima_model.pkl",
        "last_trained_month": "2026-01",  # confirmed against client's own forecast output (Jul-Dec 2026)
        # Values are in the tens of thousands (56406, 62147...) -- that's
        # revenue scale (₱), not units. Confirm with client, but plotting
        # this against unit-scale history was what made the actual line
        # look flat.
        "target": "revenue",
    },
    "demand": {
        "file": MODEL_DIR / "demand_sarima_model.pkl",
        "last_trained_month": "2026-01",  # confirmed against client's own forecast output (Jul-Dec 2026)
        "target": "units",
    },
}


@lru_cache(maxsize=None)
def load_pretrained_model(key: str):
    """Loads a client-supplied pmdarima model once per process and reuses it."""
    if key not in PRETRAINED_MODEL_META:
        raise KeyError(f"Unknown pretrained model key '{key}'. Valid keys: {list(PRETRAINED_MODEL_META)}")
    path = PRETRAINED_MODEL_META[key]["file"]
    if not path.exists():
        raise FileNotFoundError(
            f"Expected pretrained model file at {path}, but it doesn't exist. "
            f"Did you copy the .pkl the client sent into the models/ folder?"
        )
    return joblib.load(path)


def run_pretrained_forecast(key: str, months_ahead: int, history_months: int = 6) -> dict:
    """
    Forecasts using a client-supplied pre-trained pmdarima model instead of
    fitting a new one. Returns both "history" (actual monthly units from
    the Sale table, up through the last imported month) and "forecast"
    (predicted months after that), so the frontend can draw history as a
    solid line and the forecast as a dashed/broken line continuing from it
    -- same pattern as /forecast/sales.

    IMPORTANT: the model is frozen at meta["last_trained_month"] and always
    predicts sequentially from there. The forecast should pick up right
    after the last actual month you've imported (fetch_last_actual_month()),
    NOT from today's calendar date and NOT from the model's own training
    cutoff -- those are almost never the same month. We predict far enough
    ahead to cover that gap, then drop the already-elapsed months and only
    return the next `months_ahead` months counting from your latest import.
    """
    model = load_pretrained_model(key)
    meta = PRETRAINED_MODEL_META[key]
    last_known_date = pd.to_datetime(meta["last_trained_month"], format="%Y-%m")

    last_actual_month = fetch_last_actual_month()
    if last_actual_month is None:
        last_actual_month = pd.Timestamp(date.today().replace(day=1))

    elapsed_months = (
        (last_actual_month.year - last_known_date.year) * 12
        + (last_actual_month.month - last_known_date.month)
    )
    elapsed_months = max(elapsed_months, 0)

    total_periods = elapsed_months + months_ahead
    predicted, conf_int = model.predict(n_periods=total_periods, return_conf_int=True, alpha=0.05)
    predicted = np.asarray(predicted)
    conf_int = np.asarray(conf_int)

    sales_df = fetch_monthly_sales()

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
        "category_contribution": category_contribution,
        "category_insight": category_insight,
    }


def update_pretrained_model(key: str, new_values: list[float]):
    """
    Optional. pmdarima supports .update() to fold in new actuals without a
    full refit. Only wire this up if the client actually wants the model to
    evolve over time -- confirm first, since it mutates the cached model in
    memory. To persist the update across restarts you'd need to
    joblib.dump() it back to the same path afterward.
    """
    model = load_pretrained_model(key)
    model.update(np.asarray(new_values))
    return model
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
            'SELECT to_char(date_trunc(\'month\', MAX(date)), \'YYYY-MM\') AS last_month FROM "Sale"',
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
            WHERE 1=1
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
    return {"status": "ok", "time": datetime.utcnow().isoformat(), "version": "v7-prophet-arima-sarima-pretrained"}


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
        df = pd.read_sql('SELECT DISTINCT category FROM "Sale" ORDER BY category ASC', conn)
        return {"categories": df["category"].tolist()}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Endpoints serving the client's pre-trained pmdarima models
# ---------------------------------------------------------------------------
@app.get("/forecast/pretrained/{key}")
def forecast_pretrained(
    key: str,
    months_ahead: int = Query(3, ge=1, le=24, description="How many months to forecast"),
    history_months: int = Query(6, ge=6, le=24, description="How many recent months to use as the forecast basis"),
):
    """
    Serves forecasts straight from the client's pre-trained SARIMA models
    (sarima_model.pkl / demand_sarima_model.pkl) instead of fitting a new
    model on request. key is "sarima" or "demand" per PRETRAINED_MODEL_META.
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
        "monthsAhead": months_ahead,
        "historyMonths": history_months,
        "history": result["history"],
        "forecast": result["forecast"],
        "category_contribution": result["category_contribution"],
        "category_insight": result["category_insight"],
    }
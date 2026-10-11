"""Train the production Holt-Winters artifacts from the complete history.

This intentionally fits on every available month. The 80/20 models in the
notebooks are evaluation-only models and must not be deployed as pretrained
forecast artifacts.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing


def load_monthly_series(csv_path: Path, value_column: str) -> pd.Series:
    data = pd.read_csv(csv_path)
    required = {"Date", value_column}
    missing = required.difference(data.columns)
    if missing:
        raise ValueError(f"{csv_path} is missing required columns: {sorted(missing)}")

    data["Date"] = pd.to_datetime(data["Date"], dayfirst=True)
    monthly = data.groupby("Date")[value_column].sum().sort_index()
    monthly.index.freq = "MS"
    if len(monthly) < 24:
        raise ValueError(
            f"{value_column} needs at least 24 monthly observations; found {len(monthly)}."
        )
    return monthly


def train_model(series: pd.Series):
    return ExponentialSmoothing(
        series,
        trend="add",
        seasonal="add",
        seasonal_periods=12,
        initialization_method="estimated",
    ).fit(optimized=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).parent / "model",
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    targets = (
        ("Total Sales", "sales_holtwinters_model.pkl"),
        ("Items Sold", "demand_holtwinters_model.pkl"),
    )
    for column, filename in targets:
        series = load_monthly_series(args.csv_path, column)
        model = train_model(series)
        output_path = args.output_dir / filename
        joblib.dump(model, output_path)
        forecast = model.forecast(6)
        print(
            f"{filename}: {series.index[0]:%Y-%m} to {series.index[-1]:%Y-%m}; "
            f"forecast={', '.join(f'{value:.2f}' for value in forecast)}"
        )


if __name__ == "__main__":
    main()

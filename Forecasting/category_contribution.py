from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any
from urllib.request import Request, urlopen

import pandas as pd


def compute_category_contribution(
    history_df: pd.DataFrame,
    forecast_df: pd.DataFrame,
    metric: str,
) -> list[dict[str, Any]]:
    """Estimate category contributions on top of an existing total forecast.

    The model forecast is never changed. Category shares use only the latest
    six actual months and then feed each estimated share into the next window.
    """
    if metric not in {"revenue", "units"}:
        raise ValueError("metric must be 'revenue' or 'units'")

    value_column = "total_revenue" if metric == "revenue" else "total_units"
    required = {"month", "category", value_column}
    if history_df.empty or not required.issubset(history_df.columns):
        return []

    history = history_df.copy()
    history["month"] = history["month"].astype(str)
    history[value_column] = pd.to_numeric(history[value_column], errors="coerce").fillna(0.0)
    actual_months = sorted(history["month"].unique())
    window_months = actual_months[-6:]
    categories = sorted(history["category"].dropna().astype(str).unique())
    if not categories:
        return []

    totals = history.groupby("month")[value_column].sum().to_dict()
    values = history.groupby(["month", "category"])[value_column].sum().to_dict()
    share_history: dict[str, list[float]] = {category: [] for category in categories}

    for month in window_months:
        total = float(totals.get(month, 0.0))
        for category in categories:
            value = float(values.get((month, category), 0.0))
            share_history[category].append(value / total if total > 0 else 0.0)

    forecast_rows = forecast_df.to_dict("records") if not forecast_df.empty else []
    results = []
    partial_history = len(window_months) < 6

    for forecast_row in forecast_rows:
        raw_shares = {
            category: (sum(shares[-6:]) / len(shares[-6:]) if shares[-6:] else 0.0)
            for category, shares in share_history.items()
        }
        share_total = sum(raw_shares.values())
        if share_total <= 0:
            normalized = {category: 1 / len(categories) for category in categories}
        else:
            normalized = {category: share / share_total for category, share in raw_shares.items()}

        total_forecast = float(forecast_row.get("predictedValue", 0) or 0)
        contributions = [
            {
                "category": category,
                "percentage": normalized[category] * 100,
                "amount": total_forecast * normalized[category],
            }
            for category in categories
        ]
        results.append(
            {
                "month": str(forecast_row.get("month", "")),
                "metric": metric,
                "totalForecast": total_forecast,
                "historyMonthsUsed": len(window_months),
                "partialHistory": partial_history,
                "categories": contributions,
                "shareHistory": {
                    category: share_history[category][-6:] for category in categories
                },
            }
        )

        for category in categories:
            share_history[category].append(normalized[category])

    return results


def _fallback_insight(contribution: list[dict[str, Any]], metric: str) -> str:
    if not contribution:
        return "Category contribution estimates are unavailable for this forecast."
    latest = contribution[-1]
    ranked = sorted(latest["categories"], key=lambda item: item["percentage"], reverse=True)
    leaders = ", ".join(
        f"{item['category']} ({item['percentage']:.1f}%)" for item in ranked[:3]
    )
    metric_label = "sales" if metric == "revenue" else "demand"
    return (
        f"The leading estimated {metric_label} contributors are {leaders}. "
        "This is a contribution estimate based on the last six months' average category share, "
        "not a separate category forecast. Prioritize stock and staffing for the leading categories, "
        "and review lower-share categories for targeted promotion."
    )


@lru_cache(maxsize=128)
def generate_category_insight(payload: str, metric: str) -> str:
    """Generate and cache a plain-language insight without exposing a key to the UI."""
    data = json.loads(payload)
    fallback = _fallback_insight(data, metric)
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return fallback

    prompt = (
        "Write a concise business insight for a coffee shop forecast. Cover the categories driving "
        "the forecast, categories rising or falling versus their six-month average, and 2 to 4 "
        "actionable suggestions for stock, promotion, or staffing. Clearly state that the category "
        "breakdown is an estimate based on the last six months' average contribution, not a separate "
        f"category forecast. The metric is {metric}. Use plain language and no markdown table.\n\n"
        + json.dumps(data, separators=(",", ":"))
    )
    request_body = json.dumps(
        {
            "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": "You are a practical coffee shop operations adviser."},
                {"role": "user", "content": prompt},
            ],
        }
    ).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/chat/completions",
        data=request_body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
        return result["choices"][0]["message"]["content"].strip() or fallback
    except Exception:
        return fallback

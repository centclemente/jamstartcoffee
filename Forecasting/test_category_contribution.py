import unittest

import pandas as pd

from category_contribution import compute_category_contribution


class CategoryContributionTests(unittest.TestCase):
    def test_iced_coffee_rolling_share_is_fed_forward(self):
        months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
        iced_shares = [0.20, 0.23, 0.19, 0.25, 0.26, 0.18]
        rows = []
        for month, iced_share in zip(months, iced_shares):
            rows.extend([
                {"month": month, "category": "Iced Coffee", "total_revenue": iced_share * 1000, "total_units": iced_share * 100},
                {"month": month, "category": "Hot Coffee", "total_revenue": (1 - iced_share) * 1000, "total_units": (1 - iced_share) * 100},
            ])

        forecast = pd.DataFrame([
            {"month": "2026-07", "predictedValue": 10000},
            {"month": "2026-08", "predictedValue": 10000},
        ])
        result = compute_category_contribution(pd.DataFrame(rows), forecast, "revenue")
        july = next(row for row in result[0]["categories"] if row["category"] == "Iced Coffee")
        august = next(row for row in result[1]["categories"] if row["category"] == "Iced Coffee")

        self.assertAlmostEqual(july["percentage"], 21.8333333333, places=8)
        self.assertAlmostEqual(august["percentage"], 22.1388888889, places=8)
        self.assertAlmostEqual(sum(item["percentage"] for item in result[0]["categories"]), 100.0, places=8)
        self.assertAlmostEqual(sum(item["percentage"] for item in result[1]["categories"]), 100.0, places=8)


if __name__ == "__main__":
    unittest.main()

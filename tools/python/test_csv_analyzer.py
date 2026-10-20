
import csv
import tempfile
import unittest
from pathlib import Path

from csv_analyzer import analyze_csv


class TestCSVAnalyzer(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temp_dir.name) / "sample.csv"

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_csv(self, rows):
        with self.csv_path.open(
            "w", encoding="utf-8", newline=""
        ) as file:
            writer = csv.writer(file)
            writer.writerows(rows)

    def test_counts_rows_and_columns(self):
        self.write_csv([
            ["name", "score"],
            ["Aman", "85"],
            ["Riya", "92"],
        ])

        report = analyze_csv(self.csv_path)

        self.assertEqual(report["total_rows"], 2)
        self.assertEqual(report["total_columns"], 2)

    def test_detects_duplicate_rows(self):
        self.write_csv([
            ["name", "score"],
            ["Aman", "85"],
            ["Aman", "85"],
            ["Riya", "92"],
        ])

        report = analyze_csv(self.csv_path)

        self.assertEqual(report["duplicate_rows"], 1)

    def test_counts_empty_values(self):
        self.write_csv([
            ["name", "score"],
            ["Aman", "85"],
            ["Riya", ""],
        ])

        report = analyze_csv(self.csv_path)

        self.assertEqual(
            report["columns"]["score"]["empty_values"], 1
        )

    def test_empty_csv_raises_error(self):
        self.write_csv([])

        with self.assertRaises(ValueError):
            analyze_csv(self.csv_path)


if __name__ == "__main__":
    unittest.main()

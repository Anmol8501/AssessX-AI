
import json
import tempfile
import unittest
from pathlib import Path

from report_generator import generate_report, save_report


class TestReportGenerator(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

        self.csv_file = self.root / "sample.csv"
        self.csv_file.write_text(
            "name,score\nAman,85\nRiya,\nAman,85\n",
            encoding="utf-8"
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_report_contains_summary(self):
        report = generate_report(self.csv_file)

        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["summary"]["total_rows"], 3)
        self.assertEqual(report["summary"]["total_columns"], 2)
        self.assertEqual(report["summary"]["duplicate_rows"], 1)

    def test_report_contains_column_statistics(self):
        report = generate_report(self.csv_file)

        self.assertEqual(
            report["column_analysis"]["score"]["empty_values"],
            1
        )

    def test_report_can_be_saved_as_json(self):
        report = generate_report(self.csv_file)
        output_file = self.root / "reports" / "report.json"

        saved_path = save_report(report, output_file)

        self.assertTrue(saved_path.exists())

        with saved_path.open(encoding="utf-8") as file:
            loaded = json.load(file)

        self.assertEqual(loaded["status"], "completed")
        self.assertEqual(loaded["summary"]["total_rows"], 3)


if __name__ == "__main__":
    unittest.main()

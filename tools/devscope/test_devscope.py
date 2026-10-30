
"""
DevScope Test Suite
===================

Unit tests for:
    - devscope.py
    - analyzers.py

Coverage:
    - Project scanning
    - Language detection
    - File statistics
    - Ignored directories
    - Hidden file handling
    - Empty files
    - Marker detection
    - Security pattern detection
    - JSON and HTML report export
    - Python function and class extraction
    - Complexity estimation
    - Dependency analysis
    - Duplicate code detection
    - Documentation coverage
    - Naming conventions
    - Quality scoring
    - Issue filtering and grouping
    - Risk estimation
    - Error handling

Run with:
    python -m unittest discover -s tools/devscope -v

The suite uses temporary directories and never modifies
the original AssessX-AI application files.
"""

import json
import tempfile
import unittest

from pathlib import Path

from devscope import (
    ProjectScanner,
    ReportExporter,
    DevScopeError,
    ScanStatistics,
)

from analyzers import (
    AdvancedAnalyzer,
    ComplexityAnalyzer,
    SecurityAnalyzer,
    CodeSmellAnalyzer,
    NamingAnalyzer,
    DocumentationAnalyzer,
    DuplicateCodeAnalyzer,
    DependencyAnalyzer,
    QualityScorer,
    AnalysisReportExporter,
    CodeIssue,
    FunctionInfo,
    FileAnalysis,
    AnalysisReport,
    summarize_issues,
    filter_issues,
    rank_files_by_issues,
    group_issues_by_file,
    find_unused_import_candidates,
    calculate_file_risk,
    build_dependency_matrix,
    get_analysis_statistics,
)


class TemporaryProjectTestCase(unittest.TestCase):
    """Base test case providing temporary project directories."""

    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_directory.name)

    def tearDown(self):
        self.temp_directory.cleanup()

    def create_file(self, relative_path, content=""):
        """Create a file inside the temporary project."""

        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

        return path

    def create_python_file(self, content, name="sample.py"):
        return self.create_file(name, content)

    def create_javascript_file(
        self,
        content,
        name="sample.js",
    ):
        return self.create_file(name, content)


# ============================================================
# PROJECT SCANNER TESTS
# ============================================================

class TestProjectScanner(TemporaryProjectTestCase):
    """Tests for recursive project scanning."""

    def test_scan_empty_directory(self):
        scanner = ProjectScanner(self.root)
        result = scanner.scan()

        self.assertEqual(result.statistics.scanned_files, 0)
        self.assertEqual(result.statistics.total_lines, 0)

    def test_scan_single_file(self):
        self.create_python_file(
            "print('Hello World')\n"
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(result.statistics.scanned_files, 1)
        self.assertEqual(result.statistics.total_lines, 1)

    def test_scan_multiple_files(self):
        self.create_python_file(
            "print('Python')\n",
            "main.py",
        )

        self.create_javascript_file(
            "console.log('JavaScript');\n",
            "app.js",
        )

        self.create_file(
            "README.md",
            "# Project\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(result.statistics.scanned_files, 3)

    def test_recursive_directory_scanning(self):
        self.create_python_file(
            "print('Nested')\n",
            "src/modules/example.py",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(result.statistics.scanned_files, 1)
        self.assertEqual(
            result.files[0].path,
            "src/modules/example.py",
        )

    def test_language_detection_python(self):
        self.create_python_file(
            "x = 10\n"
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].language,
            "Python",
        )

    def test_language_detection_javascript(self):
        self.create_javascript_file(
            "const value = 10;\n"
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].language,
            "JavaScript",
        )

    def test_language_detection_typescript(self):
        self.create_file(
            "app.ts",
            "const value: number = 10;\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].language,
            "TypeScript",
        )

    def test_unknown_extension(self):
        self.create_file(
            "data.unknown",
            "sample content",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].language,
            "Other",
        )

    def test_file_size_calculation(self):
        content = "Hello World"

        self.create_file(
            "sample.txt",
            content,
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].size_bytes,
            len(content.encode("utf-8")),
        )

    def test_line_count(self):
        content = "one\ntwo\nthree\n"

        self.create_python_file(content)

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].lines,
            3,
        )

    def test_blank_line_count(self):
        content = "first\n\nsecond\n\n"

        self.create_python_file(content)

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].blank_lines,
            2,
        )

    def test_non_blank_line_count(self):
        content = "first\n\nsecond\n"

        self.create_python_file(content)

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].non_blank_lines,
            2,
        )

    def test_empty_file_detection(self):
        self.create_file("empty.py", "")

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.empty_files,
            1,
        )

    def test_test_file_detection(self):
        self.create_file(
            "test_example.py",
            "assert True\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.test_files,
            1,
        )

    def test_configuration_file_detection(self):
        self.create_file(
            "package.json",
            '{"name": "sample"}',
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.config_files,
            1,
        )

    def test_ignored_node_modules(self):
        self.create_file(
            "node_modules/package/index.js",
            "console.log('ignored');",
        )

        self.create_file(
            "app.js",
            "console.log('included');",
        )

        result = ProjectScanner(self.root).scan()

        paths = [
            record.path
            for record in result.files
        ]

        self.assertIn("app.js", paths)

        self.assertNotIn(
            "node_modules/package/index.js",
            paths,
        )

    def test_ignored_git_directory(self):
        self.create_file(
            ".git/config",
            "[core]\n",
        )

        self.create_file(
            "main.py",
            "pass\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.scanned_files,
            1,
        )

    def test_hidden_file_excluded_by_default(self):
        self.create_file(
            ".hidden",
            "secret",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.scanned_files,
            0,
        )

    def test_hidden_file_included_when_enabled(self):
        self.create_file(
            ".hidden",
            "visible now",
        )

        result = ProjectScanner(
            self.root,
            include_hidden=True,
        ).scan()

        self.assertEqual(
            result.statistics.scanned_files,
            1,
        )

    def test_custom_ignored_directory(self):
        self.create_file(
            "generated/output.py",
            "pass\n",
        )

        scanner = ProjectScanner(
            self.root,
            ignored_dirs={"generated"},
        )

        result = scanner.scan()

        self.assertEqual(
            result.statistics.scanned_files,
            0,
        )

    def test_custom_maximum_file_size(self):
        self.create_file(
            "large.py",
            "x" * 100,
        )

        scanner = ProjectScanner(
            self.root,
            max_file_size=10,
        )

        result = scanner.scan()

        self.assertEqual(
            result.statistics.scanned_files,
            0,
        )

        self.assertEqual(
            result.statistics.skipped_files,
            1,
        )

    def test_duplicate_file_detection(self):
        content = "print('same')\n"

        self.create_file("first.py", content)
        self.create_file("second.py", content)

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            len(result.duplicate_groups),
            1,
        )

    def test_different_files_not_duplicate(self):
        self.create_file(
            "first.py",
            "print('first')\n",
        )

        self.create_file(
            "second.py",
            "print('second')\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            len(result.duplicate_groups),
            0,
        )

    def test_todo_marker_detection(self):
        self.create_python_file(
            "# TODO: implement this feature\n"
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(len(result.markers), 1)
        self.assertEqual(result.markers[0].marker, "TODO")

    def test_fixme_marker_detection(self):
        self.create_python_file(
            "# FIXME: handle this error\n"
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(result.markers[0].marker, "FIXME")

    def test_multiple_markers(self):
        content = (
            "# TODO: first\n"
            "# FIXME: second\n"
            "# HACK: third\n"
        )

        self.create_python_file(content)

        result = ProjectScanner(self.root).scan()

        self.assertEqual(len(result.markers), 3)

    def test_possible_api_key_detection(self):
        self.create_python_file(
            'api_key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"\n'
        )

        result = ProjectScanner(self.root).scan()

        self.assertGreaterEqual(
            len(result.security_findings),
            1,
        )

    def test_tree_generation(self):
        self.create_file(
            "src/main.py",
            "print('hello')\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertTrue(result.project_tree)

        self.assertTrue(
            any("main.py" in item for item in result.project_tree)
        )

    def test_directory_summary(self):
        self.create_file(
            "src/first.py",
            "pass\n",
        )

        self.create_file(
            "src/second.py",
            "pass\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.directory_summary["src"],
            2,
        )

    def test_invalid_directory(self):
        invalid = self.root / "missing"

        scanner = ProjectScanner(invalid)

        with self.assertRaises(DevScopeError):
            scanner.scan()

    def test_file_as_project_root(self):
        file_path = self.create_file(
            "sample.py",
            "pass\n",
        )

        scanner = ProjectScanner(file_path)

        with self.assertRaises(DevScopeError):
            scanner.scan()

    def test_statistics_object(self):
        stats = ScanStatistics()

        self.assertEqual(stats.total_files, 0)
        self.assertEqual(stats.total_lines, 0)

    def test_scan_result_version(self):
        self.create_python_file("pass\n")

        result = ProjectScanner(self.root).scan()

        self.assertTrue(result.version)

    def test_scan_duration(self):
        self.create_python_file("pass\n")

        result = ProjectScanner(self.root).scan()

        self.assertGreaterEqual(
            result.statistics.duration_seconds,
            0,
        )


# ============================================================
# REPORT EXPORT TESTS
# ============================================================

class TestReportExporter(TemporaryProjectTestCase):
    """Tests for JSON and HTML report generation."""

    def setUp(self):
        super().setUp()

        self.create_python_file(
            "def hello():\n"
            "    return 'world'\n"
        )

        self.result = ProjectScanner(self.root).scan()

    def test_json_export(self):
        output = self.root / "reports/report.json"

        saved = ReportExporter.save_json(
            self.result,
            output,
        )

        self.assertTrue(saved.exists())

    def test_json_report_validity(self):
        output = self.root / "report.json"

        ReportExporter.save_json(
            self.result,
            output,
        )

        data = json.loads(
            output.read_text(encoding="utf-8")
        )

        self.assertIn("statistics", data)
        self.assertIn("files", data)
        self.assertIn("languages", data)

    def test_html_export(self):
        output = self.root / "report.html"

        saved = ReportExporter.save_html(
            self.result,
            output,
        )

        self.assertTrue(saved.exists())

    def test_html_contains_title(self):
        output = self.root / "report.html"

        ReportExporter.save_html(
            self.result,
            output,
        )

        content = output.read_text(encoding="utf-8")

        self.assertIn("DevScope", content)

    def test_html_contains_file_name(self):
        output = self.root / "report.html"

        ReportExporter.save_html(
            self.result,
            output,
        )

        content = output.read_text(encoding="utf-8")

        self.assertIn("sample.py", content)

    def test_json_export_creates_parent_directory(self):
        output = self.root / "a/b/c/report.json"

        ReportExporter.save_json(
            self.result,
            output,
        )

        self.assertTrue(output.exists())

    def test_html_export_creates_parent_directory(self):
        output = self.root / "a/b/c/report.html"

        ReportExporter.save_html(
            self.result,
            output,
        )

        self.assertTrue(output.exists())


# ============================================================
# COMPLEXITY ANALYZER TESTS
# ============================================================

class TestComplexityAnalyzer(unittest.TestCase):
    """Tests for complexity and function-size rules."""

    def setUp(self):
        self.analyzer = ComplexityAnalyzer(
            warning_threshold=10,
            critical_threshold=20,
            max_function_lines=50,
        )

    def create_function(
        self,
        name="sample",
        complexity=1,
        line_count=5,
        parameters=2,
    ):
        return FunctionInfo(
            name=name,
            file="sample.py",
            start_line=1,
            end_line=line_count,
            line_count=line_count,
            complexity=complexity,
            parameters=parameters,
            language="python",
        )

    def test_simple_function_has_no_issue(self):
        function = self.create_function(
            complexity=2,
        )

        issues = self.analyzer.analyze([function])

        self.assertEqual(len(issues), 0)

    def test_medium_complexity_warning(self):
        function = self.create_function(
            complexity=12,
        )

        issues = self.analyzer.analyze([function])

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].severity, "medium")

    def test_high_complexity_warning(self):
        function = self.create_function(
            complexity=25,
        )

        issues = self.analyzer.analyze([function])

        self.assertEqual(issues[0].severity, "high")

    def test_long_function_detection(self):
        function = self.create_function(
            line_count=80,
        )

        issues = self.analyzer.analyze([function])

        self.assertTrue(
            any(issue.rule_id == "SIZE001" for issue in issues)
        )

    def test_many_parameters_detection(self):
        function = self.create_function(
            parameters=10,
        )

        issues = self.analyzer.analyze([function])

        self.assertTrue(
            any(issue.rule_id == "DESIGN001" for issue in issues)
        )

    def test_multiple_function_analysis(self):
        functions = [
            self.create_function("one", 2),
            self.create_function("two", 15),
            self.create_function("three", 25),
        ]

        issues = self.analyzer.analyze(functions)

        self.assertEqual(len(issues), 2)

    def test_empty_function_list(self):
        self.assertEqual(
            self.analyzer.analyze([]),
            [],
        )


# ============================================================
# PYTHON SOURCE EXTRACTION TESTS
# ============================================================

class TestAdvancedAnalyzer(TemporaryProjectTestCase):
    """Tests for project-level analysis."""

    def test_python_function_detection(self):
        self.create_python_file(
            "def hello():\n"
            "    return 'world'\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(report.total_functions, 1)

        self.assertEqual(
            report.functions[0].name,
            "hello",
        )

    def test_python_class_detection(self):
        self.create_python_file(
            "class Example:\n"
            "    pass\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(report.total_classes, 1)

        self.assertEqual(
            report.classes[0].name,
            "Example",
        )

    def test_async_function_detection(self):
        self.create_python_file(
            "async def fetch_data():\n"
            "    return True\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(report.total_functions, 1)

    def test_function_parameter_count(self):
        self.create_python_file(
            "def calculate(a, b, c):\n"
            "    return a + b + c\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(
            report.functions[0].parameters,
            3,
        )

    def test_python_complexity(self):
        self.create_python_file(
            "def check(value):\n"
            "    if value:\n"
            "        if value > 10:\n"
            "            return True\n"
            "    return False\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertGreaterEqual(
            report.maximum_complexity,
            3,
        )

    def test_python_docstring_detection(self):
        self.create_python_file(
            'def hello():\n'
            '    """Return a greeting."""\n'
            '    return "hello"\n'
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(
            report.documentation_coverage,
            100.0,
        )

    def test_missing_docstring_detection(self):
        self.create_python_file(
            "def hello():\n"
            "    return 'hello'\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(
            report.documentation_coverage,
            0.0,
        )

    def test_python_import_extraction(self):
        self.create_python_file(
            "import os\n"
            "import json\n"
            "from pathlib import Path\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        dependencies = {
            item.dependency
            for item in report.dependencies
        }

        self.assertIn("os", dependencies)
        self.assertIn("json", dependencies)
        self.assertIn("pathlib", dependencies)

    def test_multiple_source_files(self):
        self.create_python_file(
            "def first():\n"
            "    pass\n",
            "first.py",
        )

        self.create_python_file(
            "def second():\n"
            "    pass\n",
            "second.py",
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(report.files_analyzed, 2)
        self.assertEqual(report.total_functions, 2)

    def test_invalid_project_path(self):
        invalid = self.root / "missing"

        analyzer = AdvancedAnalyzer(invalid)

        with self.assertRaises(ValueError):
            analyzer.analyze()

    def test_analysis_report_has_quality_grade(self):
        self.create_python_file(
            "def hello():\n"
            "    return True\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertTrue(report.quality_grade)

    def test_analysis_report_statistics(self):
        self.create_python_file(
            "def hello():\n"
            "    return True\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(
            report.files_analyzed,
            1,
        )

    def test_syntax_error_does_not_crash_python_extraction(self):
        self.create_python_file(
            "def broken(\n"
            "    print('invalid')\n"
        )

        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(report.total_functions, 0)


# ============================================================
# SECURITY ANALYZER TESTS
# ============================================================

class TestSecurityAnalyzer(unittest.TestCase):
    """Tests for potential security-pattern detection."""

    def setUp(self):
        self.analyzer = SecurityAnalyzer()

    def test_eval_detection(self):
        issues = self.analyzer.analyze(
            "result = eval(user_input)\n",
            "app.py",
        )

        self.assertTrue(issues)

    def test_exec_detection(self):
        issues = self.analyzer.analyze(
            "exec(source_code)\n",
            "app.py",
        )

        self.assertTrue(issues)

    def test_shell_execution_detection(self):
        issues = self.analyzer.analyze(
            "os.system(command)\n",
            "app.py",
        )

        self.assertTrue(issues)

    def test_http_detection(self):
        issues = self.analyzer.analyze(
            'url = "http://example.com"\n',
            "app.py",
        )

        self.assertTrue(issues)

    def test_disabled_certificate_detection(self):
        issues = self.analyzer.analyze(
            "requests.get(url, verify=False)\n",
            "app.py",
        )

        self.assertTrue(issues)

    def test_debug_mode_detection(self):
        issues = self.analyzer.analyze(
            "DEBUG = True\n",
            "settings.py",
        )

        self.assertTrue(issues)

    def test_empty_content(self):
        issues = self.analyzer.analyze(
            "",
            "empty.py",
        )

        self.assertEqual(issues, [])

    def test_safe_source(self):
        issues = self.analyzer.analyze(
            "def add(a, b):\n"
            "    return a + b\n",
            "safe.py",
        )

        self.assertEqual(issues, [])

    def test_issue_has_file_name(self):
        issues = self.analyzer.analyze(
            "eval(value)\n",
            "danger.py",
        )

        self.assertEqual(
            issues[0].file,
            "danger.py",
        )

    def test_issue_has_line_number(self):
        issues = self.analyzer.analyze(
            "x = 1\n"
            "eval(value)\n",
            "danger.py",
        )

        self.assertEqual(
            issues[0].line,
            2,
        )


# ============================================================
# CODE SMELL ANALYZER TESTS
# ============================================================

class TestCodeSmellAnalyzer(unittest.TestCase):
    """Tests for common source-code quality concerns."""

    def setUp(self):
        self.analyzer = CodeSmellAnalyzer(
            max_line_length=40,
            max_file_lines=5,
        )

    def test_long_line_detection(self):
        content = "x = " + "a" * 50

        issues = self.analyzer.analyze(
            content,
            "sample.py",
            "python",
        )

        self.assertTrue(
            any(issue.rule_id == "STYLE001" for issue in issues)
        )

    def test_large_file_detection(self):
        content = "\n".join(
            f"value_{i} = {i}"
            for i in range(10)
        )

        issues = self.analyzer.analyze(
            content,
            "large.py",
            "python",
        )

        self.assertTrue(
            any(issue.rule_id == "SIZE002" for issue in issues)
        )

    def test_trailing_whitespace_detection(self):
        issues = self.analyzer.analyze(
            "value = 10   \n",
            "sample.py",
            "python",
        )

        self.assertTrue(
            any(issue.rule_id == "STYLE003" for issue in issues)
        )

    def test_tab_detection_in_python(self):
        issues = self.analyzer.analyze(
            "\tvalue = 10\n",
            "sample.py",
            "python",
        )

        self.assertTrue(
            any(issue.rule_id == "STYLE002" for issue in issues)
        )

    def test_empty_content(self):
        issues = self.analyzer.analyze(
            "",
            "empty.py",
            "python",
        )

        self.assertEqual(issues, [])


# ============================================================
# NAMING ANALYZER TESTS
# ============================================================

class TestNamingAnalyzer(unittest.TestCase):
    """Tests for Python naming conventions."""

    def setUp(self):
        self.analyzer = NamingAnalyzer()

    def test_snake_case_function(self):
        issues = self.analyzer.analyze(
            "def calculate_total():\n"
            "    pass\n",
            "sample.py",
            "python",
        )

        self.assertEqual(issues, [])

    def test_camel_case_function(self):
        issues = self.analyzer.analyze(
            "def calculateTotal():\n"
            "    pass\n",
            "sample.py",
            "python",
        )

        self.assertEqual(len(issues), 1)

    def test_uppercase_function(self):
        issues = self.analyzer.analyze(
            "def CALCULATE():\n"
            "    pass\n",
            "sample.py",
            "python",
        )

        self.assertTrue(issues)

    def test_dunder_function_ignored(self):
        issues = self.analyzer.analyze(
            "def __init__(self):\n"
            "    pass\n",
            "sample.py",
            "python",
        )

        self.assertEqual(issues, [])


# ============================================================
# DOCUMENTATION ANALYZER TESTS
# ============================================================

class TestDocumentationAnalyzer(unittest.TestCase):
    """Tests for function documentation coverage."""

    def setUp(self):
        self.analyzer = DocumentationAnalyzer()

    def make_function(self, name, documented):
        return FunctionInfo(
            name=name,
            file="sample.py",
            start_line=1,
            end_line=3,
            line_count=3,
            complexity=1,
            documented=documented,
        )

    def test_full_documentation_coverage(self):
        functions = [
            self.make_function("one", True),
            self.make_function("two", True),
        ]

        coverage, issues = self.analyzer.analyze(
            "",
            "sample.py",
            "python",
            functions,
        )

        self.assertEqual(coverage, 100.0)
        self.assertEqual(len(issues), 0)

    def test_zero_documentation_coverage(self):
        functions = [
            self.make_function("one", False),
        ]

        coverage, issues = self.analyzer.analyze(
            "",
            "sample.py",
            "python",
            functions,
        )

        self.assertEqual(coverage, 0.0)
        self.assertEqual(len(issues), 1)

    def test_partial_documentation_coverage(self):
        functions = [
            self.make_function("one", True),
            self.make_function("two", False),
        ]

        coverage, issues = self.analyzer.analyze(
            "",
            "sample.py",
            "python",
            functions,
        )

        self.assertEqual(coverage, 50.0)
        self.assertEqual(len(issues), 1)

    def test_no_functions(self):
        coverage, issues = self.analyzer.analyze(
            "",
            "sample.py",
            "python",
            [],
        )

        self.assertEqual(coverage, 100.0)
        self.assertEqual(issues, [])


# ============================================================
# DUPLICATE CODE ANALYZER TESTS
# ============================================================

class TestDuplicateCodeAnalyzer(unittest.TestCase):
    """Tests for repeated code block detection."""

    def setUp(self):
        self.analyzer = DuplicateCodeAnalyzer(
            minimum_lines=3,
        )

    def test_duplicate_block_across_files(self):
        common = (
            "first = 1\n"
            "second = 2\n"
            "third = 3\n"
        )

        sources = {
            "first.py": common,
            "second.py": common,
        }

        issues = self.analyzer.analyze(sources)

        self.assertTrue(issues)

    def test_unique_blocks(self):
        sources = {
            "first.py": (
                "a = 1\n"
                "b = 2\n"
                "c = 3\n"
            ),
            "second.py": (
                "x = 8\n"
                "y = 9\n"
                "z = 10\n"
            ),
        }

        issues = self.analyzer.analyze(sources)

        self.assertEqual(issues, [])

    def test_short_blocks_ignored(self):
        sources = {
            "first.py": "a = 1\nb = 2\n",
            "second.py": "a = 1\nb = 2\n",
        }

        issues = self.analyzer.analyze(sources)

        self.assertEqual(issues, [])

    def test_empty_source(self):
        issues = self.analyzer.analyze({})

        self.assertEqual(issues, [])

    def test_duplicate_issue_rule_id(self):
        common = "a = 1\nb = 2\nc = 3\n"

        issues = self.analyzer.analyze({
            "one.py": common,
            "two.py": common,
        })

        self.assertTrue(
            all(issue.rule_id == "DUP001" for issue in issues)
        )


# ============================================================
# DEPENDENCY ANALYZER TESTS
# ============================================================

class TestDependencyAnalyzer(unittest.TestCase):
    """Tests for imports and dependency graph construction."""

    def setUp(self):
        self.analyzer = DependencyAnalyzer()

    def test_python_import(self):
        dependencies = self.analyzer.analyze_file(
            "import os\n",
            "sample.py",
            "python",
        )

        self.assertEqual(
            dependencies[0].dependency,
            "os",
        )

    def test_python_from_import(self):
        dependencies = self.analyzer.analyze_file(
            "from pathlib import Path\n",
            "sample.py",
            "python",
        )

        self.assertEqual(
            dependencies[0].dependency,
            "pathlib",
        )

    def test_javascript_import(self):
        dependencies = self.analyzer.analyze_file(
            "import React from 'react';\n",
            "app.js",
            "javascript",
        )

        self.assertTrue(dependencies)

    def test_java_import(self):
        dependencies = self.analyzer.analyze_file(
            "import java.util.List;\n",
            "Main.java",
            "java",
        )

        self.assertEqual(
            dependencies[0].dependency,
            "java.util.List",
        )

    def test_go_import(self):
        dependencies = self.analyzer.analyze_file(
            'import "fmt"\n',
            "main.go",
            "go",
        )

        self.assertEqual(
            dependencies[0].dependency,
            "fmt",
        )

    def test_rust_import(self):
        dependencies = self.analyzer.analyze_file(
            "use std::collections::HashMap;\n",
            "main.rs",
            "rust",
        )

        self.assertTrue(dependencies)

    def test_dependency_graph(self):
        dependencies = self.analyzer.analyze_file(
            "import os\nimport json\n",
            "main.py",
            "python",
        )

        graph = self.analyzer.build_graph(dependencies)

        self.assertIn("main.py", graph)
        self.assertEqual(len(graph["main.py"]), 2)

    def test_external_dependency_list(self):
        dependencies = self.analyzer.analyze_file(
            "import os\nimport requests\n",
            "main.py",
            "python",
        )

        external = self.analyzer.external_dependencies(
            dependencies,
            local_modules={"os"},
        )

        self.assertEqual(external, ["requests"])

    def test_empty_dependency_list(self):
        graph = self.analyzer.build_graph([])

        self.assertEqual(graph, {})


# ============================================================
# QUALITY SCORER TESTS
# ============================================================

class TestQualityScorer(unittest.TestCase):
    """Tests for indicative project quality scoring."""

    def setUp(self):
        self.scorer = QualityScorer()

    def test_clean_project_score(self):
        score, grade = self.scorer.score(
            [],
            100,
            1,
        )

        self.assertEqual(score, 100.0)
        self.assertEqual(grade, "A")

    def test_high_severity_penalty(self):
        issue = CodeIssue(
            "SEC001",
            "security",
            "high",
            "Dynamic execution",
            "app.py",
        )

        score, grade = self.scorer.score(
            [issue],
            100,
            1,
        )

        self.assertLess(score, 100)

    def test_medium_severity_penalty(self):
        issue = CodeIssue(
            "SIZE001",
            "maintainability",
            "medium",
            "Large function",
            "app.py",
        )

        score, grade = self.scorer.score(
            [issue],
            100,
            1,
        )

        self.assertLess(score, 100)

    def test_low_severity_penalty(self):
        issue = CodeIssue(
            "STYLE001",
            "style",
            "low",
            "Long line",
            "app.py",
        )

        score, grade = self.scorer.score(
            [issue],
            100,
            1,
        )

        self.assertLess(score, 100)

    def test_score_never_negative(self):
        issues = [
            CodeIssue(
                "SEC001",
                "security",
                "high",
                "Issue",
                "app.py",
            )
            for _ in range(100)
        ]

        score, grade = self.scorer.score(
            issues,
            0,
            100,
        )

        self.assertGreaterEqual(score, 0)

    def test_score_never_exceeds_hundred(self):
        score, grade = self.scorer.score(
            [],
            100,
            0,
        )

        self.assertLessEqual(score, 100)

    def test_grade_is_string(self):
        score, grade = self.scorer.score(
            [],
            100,
            1,
        )

        self.assertIsInstance(grade, str)


# ============================================================
# REPORT EXPORTER TESTS FOR ADVANCED ANALYSIS
# ============================================================

class TestAdvancedReportExporter(TemporaryProjectTestCase):
    """Tests for advanced analysis report serialization."""

    def setUp(self):
        super().setUp()

        self.create_python_file(
            'def hello():\n'
            '    """Greeting."""\n'
            '    return "hello"\n'
        )

        self.report = AdvancedAnalyzer(self.root).analyze()

    def test_json_export(self):
        output = self.root / "analysis.json"

        saved = AnalysisReportExporter.to_json(
            self.report,
            output,
        )

        self.assertTrue(saved.exists())

    def test_json_contains_analysis_fields(self):
        output = self.root / "analysis.json"

        AnalysisReportExporter.to_json(
            self.report,
            output,
        )

        data = json.loads(
            output.read_text(encoding="utf-8")
        )

        self.assertIn("quality_score", data)
        self.assertIn("functions", data)
        self.assertIn("dependencies", data)

    def test_csv_export(self):
        output = self.root / "analysis.csv"

        saved = AnalysisReportExporter.to_csv(
            self.report,
            output,
        )

        self.assertTrue(saved.exists())

    def test_csv_header(self):
        output = self.root / "analysis.csv"

        AnalysisReportExporter.to_csv(
            self.report,
            output,
        )

        content = output.read_text(encoding="utf-8")

        self.assertIn("Language", content)
        self.assertIn("Functions", content)


# ============================================================
# ISSUE UTILITY TESTS
# ============================================================

class TestIssueUtilities(unittest.TestCase):
    """Tests for issue filtering, grouping and summaries."""

    def setUp(self):
        self.issues = [
            CodeIssue(
                "SEC001",
                "security",
                "high",
                "Dynamic execution",
                "app.py",
                10,
            ),
            CodeIssue(
                "STYLE001",
                "style",
                "low",
                "Long line",
                "app.py",
                15,
            ),
            CodeIssue(
                "SIZE001",
                "maintainability",
                "medium",
                "Large function",
                "service.py",
                20,
            ),
        ]

    def test_issue_summary_total(self):
        summary = summarize_issues(self.issues)

        self.assertEqual(summary["total"], 3)

    def test_issue_summary_severity(self):
        summary = summarize_issues(self.issues)

        self.assertEqual(
            summary["by_severity"]["high"],
            1,
        )

    def test_issue_summary_categories(self):
        summary = summarize_issues(self.issues)

        self.assertIn(
            "security",
            summary["by_category"],
        )

    def test_filter_high_severity(self):
        result = filter_issues(
            self.issues,
            severity="high",
        )

        self.assertEqual(len(result), 1)

    def test_filter_category(self):
        result = filter_issues(
            self.issues,
            category="style",
        )

        self.assertEqual(len(result), 1)

    def test_filter_filename(self):
        result = filter_issues(
            self.issues,
            filename="service.py",
        )

        self.assertEqual(len(result), 1)

    def test_combined_filters(self):
        result = filter_issues(
            self.issues,
            severity="high",
            category="security",
            filename="app.py",
        )

        self.assertEqual(len(result), 1)

    def test_no_matching_filter(self):
        result = filter_issues(
            self.issues,
            severity="critical",
        )

        self.assertEqual(result, [])

    def test_group_issues_by_file(self):
        grouped = group_issues_by_file(self.issues)

        self.assertEqual(len(grouped["app.py"]), 2)
        self.assertEqual(len(grouped["service.py"]), 1)

    def test_empty_issue_grouping(self):
        grouped = group_issues_by_file([])

        self.assertEqual(grouped, {})


# ============================================================
# RISK AND DEPENDENCY UTILITY TESTS
# ============================================================

class TestRiskAndDependencyUtilities(unittest.TestCase):
    """Tests for file risk and dependency utility functions."""

    def test_low_risk_file(self):
        analysis = FileAnalysis(
            path="safe.py",
            language="python",
            lines=20,
        )

        result = calculate_file_risk(analysis)

        self.assertEqual(result["risk_level"], "low")

    def test_high_risk_file(self):
        analysis = FileAnalysis(
            path="complex.py",
            language="python",
            lines=600,
            maximum_complexity=25,
        )

        analysis.issues.append(
            CodeIssue(
                "SEC001",
                "security",
                "high",
                "Potential security issue",
                "complex.py",
            )
        )

        result = calculate_file_risk(analysis)

        self.assertEqual(result["risk_level"], "high")

    def test_dependency_matrix(self):
        from analyzers import DependencyInfo

        dependencies = [
            DependencyInfo(
                "main.py",
                "os",
                "import",
                1,
            ),
            DependencyInfo(
                "main.py",
                "json",
                "import",
                2,
            ),
        ]

        matrix = build_dependency_matrix(dependencies)

        self.assertEqual(
            set(matrix["main.py"]),
            {"os", "json"},
        )

    def test_empty_dependency_matrix(self):
        matrix = build_dependency_matrix([])

        self.assertEqual(matrix, {})

    def test_unused_import_candidate(self):
        from analyzers import DependencyInfo

        dependencies = [
            DependencyInfo(
                "main.py",
                "unused_module",
                "import",
                1,
            )
        ]

        sources = {
            "main.py": "import unused_module\nprint('hello')\n"
        }

        candidates = find_unused_import_candidates(
            dependencies,
            sources,
        )

        self.assertIn(
            "main.py",
            candidates,
        )

    def test_used_import_not_candidate(self):
        from analyzers import DependencyInfo

        dependencies = [
            DependencyInfo(
                "main.py",
                "json",
                "import",
                1,
            )
        ]

        sources = {
            "main.py": (
                "import json\n"
                "json.dumps({'value': 1})\n"
            )
        }

        candidates = find_unused_import_candidates(
            dependencies,
            sources,
        )

        self.assertNotIn(
            "main.py",
            candidates,
        )


# ============================================================
# ANALYSIS STATISTICS TESTS
# ============================================================

class TestAnalysisStatistics(TemporaryProjectTestCase):
    """Tests for aggregate analysis statistics."""

    def setUp(self):
        super().setUp()

        self.create_python_file(
            "def example():\n"
            '    """Example function."""\n'
            "    return True\n"
        )

        self.report = AdvancedAnalyzer(self.root).analyze()

    def test_statistics_file_count(self):
        stats = get_analysis_statistics(self.report)

        self.assertEqual(stats["files"], 1)

    def test_statistics_function_count(self):
        stats = get_analysis_statistics(self.report)

        self.assertEqual(stats["functions"], 1)

    def test_statistics_contains_quality(self):
        stats = get_analysis_statistics(self.report)

        self.assertIn("quality_score", stats)
        self.assertIn("quality_grade", stats)

    def test_statistics_contains_issue_count(self):
        stats = get_analysis_statistics(self.report)

        self.assertIn("issues", stats)

    def test_rank_files_by_issues(self):
        report = AnalysisReport(
            root=".",
            files_analyzed=2,
            total_functions=0,
            total_classes=0,
            average_complexity=0,
            maximum_complexity=0,
            documentation_coverage=100,
            issues=[
                CodeIssue(
                    "SEC001",
                    "security",
                    "high",
                    "Issue",
                    "first.py",
                ),
                CodeIssue(
                    "STYLE001",
                    "style",
                    "low",
                    "Issue",
                    "first.py",
                ),
                CodeIssue(
                    "SIZE001",
                    "maintainability",
                    "medium",
                    "Issue",
                    "second.py",
                ),
            ],
        )

        ranking = rank_files_by_issues(report)

        self.assertEqual(ranking[0][0], "first.py")
        self.assertEqual(ranking[0][1], 2)


# ============================================================
# EDGE CASE TESTS
# ============================================================

class TestEdgeCases(TemporaryProjectTestCase):
    """Tests for unusual inputs and boundary conditions."""

    def test_unicode_source_file(self):
        self.create_python_file(
            'message = "नमस्ते दुनिया"\n'
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.scanned_files,
            1,
        )

    def test_large_number_of_small_files(self):
        for index in range(50):
            self.create_file(
                f"src/file_{index}.py",
                f"value = {index}\n",
            )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.scanned_files,
            50,
        )

    def test_nested_project_structure(self):
        self.create_file(
            "src/core/engine/runner.py",
            "pass\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.scanned_files,
            1,
        )

    def test_file_without_extension(self):
        self.create_file(
            "LICENSE",
            "Sample license",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].extension,
            "[no extension]",
        )

    def test_whitespace_only_file(self):
        self.create_python_file(
            "   \n   \n"
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.files[0].blank_lines,
            2,
        )

    def test_empty_analysis_project(self):
        report = AdvancedAnalyzer(self.root).analyze()

        self.assertEqual(report.files_analyzed, 0)
        self.assertEqual(report.total_functions, 0)
        self.assertEqual(report.total_classes, 0)

    def test_empty_project_quality_score(self):
        report = AdvancedAnalyzer(self.root).analyze()

        self.assertGreaterEqual(
            report.quality_score,
            0,
        )

    def test_issue_filter_with_empty_input(self):
        result = filter_issues(
            [],
            severity="high",
        )

        self.assertEqual(result, [])

    def test_unicode_filename(self):
        self.create_file(
            "src/उदाहरण.py",
            "pass\n",
        )

        result = ProjectScanner(self.root).scan()

        self.assertEqual(
            result.statistics.scanned_files,
            1,
        )


# ============================================================
# TEST RUNNER
# ============================================================

def run_test_suite():
    """Execute the complete DevScope unit test suite."""

    loader = unittest.TestLoader()

    suite = loader.loadTestsFromModule(
        __import__(__name__)
    )

    runner = unittest.TextTestRunner(
        verbosity=2,
    )

    result = runner.run(suite)

    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_test_suite()

    raise SystemExit(
        0 if success else 1
    )

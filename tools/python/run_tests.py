
import subprocess
import sys
from pathlib import Path


def discover_tests():
    test_dir = Path(__file__).resolve().parent

    return sorted(
        file for file in test_dir.glob("test_*.py")
        if file.name != Path(__file__).name
    )


def run_test(test_file):
    print(f"\nRunning: {test_file.name}")
    print("-" * 45)

    result = subprocess.run(
        [sys.executable, "-m", "unittest", str(test_file)],
        cwd=test_file.parent,
        check=False,
    )

    if result.returncode == 0:
        print(f"PASSED: {test_file.name}")
        return True

    print(f"FAILED: {test_file.name}")
    return False


def main():
    test_files = discover_tests()

    if not test_files:
        print("No test files found.")
        return 1

    results = [run_test(file) for file in test_files]
    passed = sum(results)
    failed = len(results) - passed

    print("\n========== TEST SUMMARY ==========")
    print(f"Total:  {len(results)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print("==================================")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

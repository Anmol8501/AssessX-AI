
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const testFiles = [
    "json-search.test.js",
    "test-data-generator.test.js"
];

function runTest(file) {
    const testPath = path.join(__dirname, file);

    console.log(`\nRunning: ${file}`);
    console.log("-".repeat(45));

    const result = spawnSync(
        process.execPath,
        [testPath],
        {
            encoding: "utf8",
            stdio: "inherit"
        }
    );

    if (result.error) {
        console.error(`Could not run ${file}:`, result.error.message);
        return false;
    }

    if (result.status !== 0) {
        console.error(`FAILED: ${file}`);
        return false;
    }

    console.log(`PASSED: ${file}`);
    return true;
}

function main() {
    let passed = 0;

    for (const file of testFiles) {
        if (runTest(file)) {
            passed++;
        }
    }

    console.log("\n========== TEST SUMMARY ==========");
    console.log(`Passed: ${passed}/${testFiles.length}`);
    console.log(`Failed: ${testFiles.length - passed}`);
    console.log("==================================");

    if (passed !== testFiles.length) {
        process.exitCode = 1;
    }
}

main();

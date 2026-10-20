
const fs = require("fs");

function validateJSON(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(content);

        console.log("Valid JSON:", filePath);
        console.log(
            "Root type:",
            Array.isArray(data) ? "array" : typeof data
        );

        return true;
    } catch (error) {
        console.error("JSON validation failed:", error.message);
        return false;
    }
}

if (require.main === module) {
    const filePath = process.argv[2];

    if (!filePath) {
        console.error("Usage: node json-validator.js <file.json>");
        process.exitCode = 1;
    } else if (!validateJSON(filePath)) {
        process.exitCode = 1;
    }
}

module.exports = { validateJSON };

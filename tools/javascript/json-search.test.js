
const assert = require("node:assert/strict");
const { findKey } = require("./json-search");

function runTests() {
    const sample = {
        user: {
            name: "Aman",
            email: "aman@example.com"
        },
        members: [
            { email: "riya@example.com" },
            { name: "Karan" }
        ]
    };

    const emailResults = findKey(sample, "email");
    assert.equal(emailResults.length, 2);
    assert.equal(
        emailResults[0].value,
        "aman@example.com"
    );

    const nameResults = findKey(sample, "NAME");
    assert.equal(nameResults.length, 2);

    const missingResults = findKey(sample, "phone");
    assert.equal(missingResults.length, 0);

    assert.deepEqual(findKey(null, "email"), []);

    console.log("All JSON search tests passed.");
}

runTests();

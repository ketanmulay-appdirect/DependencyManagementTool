#!/bin/bash

# Test runner script for vulnerability fixer
# This script runs all unit and integration tests to ensure functionality works correctly

set -e

echo "🧪 Running Vulnerability Fixer Tests"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✅ $message${NC}"
    elif [ "$status" = "FAIL" ]; then
        echo -e "${RED}❌ $message${NC}"
    else
        echo -e "${YELLOW}⚠️  $message${NC}"
    fi
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json not found. Please run this script from the backend directory.${NC}"
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building TypeScript..."
npm run build

echo ""
echo "🧪 Running Unit Tests..."
echo "========================"

# Run unit tests
if npm test -- test/unit/ --passWithNoTests; then
    print_status "PASS" "Unit tests passed"
else
    print_status "FAIL" "Unit tests failed"
    exit 1
fi

echo ""
echo "🧪 Running Integration Tests..."
echo "==============================="

# Run integration tests
if npm test -- test/integration/ --passWithNoTests; then
    print_status "PASS" "Integration tests passed"
else
    print_status "FAIL" "Integration tests failed"
    exit 1
fi

echo ""
echo "🔍 Running Specific Functionality Tests..."
echo "=========================================="

# Test Gradle functionality specifically
echo "Testing Gradle dependency updates..."
if npm test -- test/unit/GradleFileParser.test.ts --testNamePattern="should update direct dependency version correctly"; then
    print_status "PASS" "Gradle dependency updates work correctly"
else
    print_status "FAIL" "Gradle dependency updates are broken"
    exit 1
fi

# Test Maven functionality specifically
echo "Testing Maven dependency updates..."
if npm test -- test/unit/MavenFileParser.test.ts --testNamePattern="should update direct dependency version correctly"; then
    print_status "PASS" "Maven dependency updates work correctly"
else
    print_status "FAIL" "Maven dependency updates are broken"
    exit 1
fi

# Test integration workflow
echo "Testing full vulnerability fixing workflow..."
if npm test -- test/integration/VulnerabilityFixer.integration.test.ts --testNamePattern="should fix Gradle dependencies correctly"; then
    print_status "PASS" "Full Gradle vulnerability fixing workflow works"
else
    print_status "FAIL" "Full Gradle vulnerability fixing workflow is broken"
    exit 1
fi

if npm test -- test/integration/VulnerabilityFixer.integration.test.ts --testNamePattern="should fix Maven dependencies correctly"; then
    print_status "PASS" "Full Maven vulnerability fixing workflow works"
else
    print_status "FAIL" "Full Maven vulnerability fixing workflow is broken"
    exit 1
fi

echo ""
echo "🎯 Running Regression Tests..."
echo "=============================="

# Test the specific changes from the screenshot
echo "Testing Spring Boot plugin version update..."
if npm test -- test/unit/GradleFileParser.test.ts --testNamePattern="should update Spring Boot plugin version correctly"; then
    print_status "PASS" "Spring Boot plugin version updates work"
else
    print_status "FAIL" "Spring Boot plugin version updates are broken"
    exit 1
fi

echo "Testing Spring Web dependency update..."
if npm test -- test/unit/GradleFileParser.test.ts --testNamePattern="should update direct dependency version correctly"; then
    print_status "PASS" "Spring Web dependency updates work"
else
    print_status "FAIL" "Spring Web dependency updates are broken"
    exit 1
fi

echo "Testing Commons IO dependency update..."
if npm test -- test/unit/GradleFileParser.test.ts --testNamePattern="should handle dependencies with different quote styles"; then
    print_status "PASS" "Commons IO dependency updates work"
else
    print_status "FAIL" "Commons IO dependency updates are broken"
    exit 1
fi

echo "Testing Spring Security Core dependency update..."
if npm test -- test/unit/GradleFileParser.test.ts --testNamePattern="should handle multiple dependencies with same name but different versions"; then
    print_status "PASS" "Spring Security Core dependency updates work"
else
    print_status "FAIL" "Spring Security Core dependency updates are broken"
    exit 1
fi

echo "Testing variable version updates..."
if npm test -- test/unit/GradleFileParser.test.ts --testNamePattern="should update dependency with variable version"; then
    print_status "PASS" "Variable version updates work"
else
    print_status "FAIL" "Variable version updates are broken"
    exit 1
fi

echo ""
echo "📊 Test Summary"
echo "==============="
print_status "PASS" "All tests completed successfully!"
echo ""
echo "✅ Gradle dependency updates: WORKING"
echo "✅ Maven dependency updates: WORKING"
echo "✅ Integration workflows: WORKING"
echo "✅ Regression tests: PASSED"
echo ""
echo "🎉 All functionality is working correctly!"
echo "   The vulnerability fixer can now properly update both Gradle and Maven dependencies."
echo "   Run these tests after any code changes to prevent regressions." 
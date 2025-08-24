# Vulnerability Fixer Tests

This directory contains comprehensive unit and integration tests for the vulnerability fixer functionality. These tests ensure that both Gradle and Maven dependency updates work correctly and prevent regressions.

## Test Structure

```
test/
├── unit/                          # Unit tests for individual components
│   ├── GradleFileParser.test.ts   # Tests for Gradle file parsing and updates
│   └── MavenFileParser.test.ts    # Tests for Maven file parsing and updates
├── integration/                   # Integration tests for full workflows
│   └── VulnerabilityFixer.integration.test.ts  # End-to-end vulnerability fixing tests
├── setup.ts                       # Jest setup and mocks
├── run-tests.sh                   # Test runner script
└── README.md                      # This file
```

## Test Coverage

### Unit Tests

#### GradleFileParser.test.ts
Tests the Gradle file parser functionality:

- ✅ **Direct dependency version updates** - Updates `implementation 'org.springframework:spring-web:6.0.0'` to `6.1.8`
- ✅ **Spring Boot plugin version updates** - Updates `id 'org.springframework.boot' version '3.1.1'` to `3.1.11`
- ✅ **Variable version updates** - Updates hardcoded versions to variables like `${springBootVersion}`
- ✅ **Different quote styles** - Handles both single and double quotes
- ✅ **Dependency constraints** - Adds `force` statements for transitive dependencies
- ✅ **Error handling** - Returns false when dependencies not found

#### MavenFileParser.test.ts
Tests the Maven file parser functionality:

- ✅ **Direct dependency version updates** - Updates `<version>6.0.0</version>` to `6.1.8`
- ✅ **Property version updates** - Updates properties like `<spring.version>6.0.0</spring.version>`
- ✅ **Parent version updates** - Updates Spring Boot parent versions
- ✅ **Dependency management** - Adds dependencies to `<dependencyManagement>` section
- ✅ **Comment generation** - Adds proper CVE comments
- ✅ **Error handling** - Returns false when dependencies not found

### Integration Tests

#### VulnerabilityFixer.integration.test.ts
Tests the complete vulnerability fixing workflow:

- ✅ **Gradle vulnerability fixing** - Full end-to-end Gradle dependency updates
- ✅ **Maven vulnerability fixing** - Full end-to-end Maven dependency updates
- ✅ **Mixed package managers** - Handles both Gradle and Maven in same analysis
- ✅ **Transitive dependencies** - Tests dependency management and constraints
- ✅ **File writing** - Verifies changes are written to disk correctly

## Running Tests

### Quick Test Run
```bash
# Run all tests
npm test

# Run only unit tests
npm test test/unit/

# Run only integration tests
npm test test/integration/

# Run specific test file
npm test test/unit/GradleFileParser.test.ts
```

### Comprehensive Test Run
```bash
# Run the test runner script (recommended)
./test/run-tests.sh
```

The test runner script:
- Installs dependencies
- Builds TypeScript
- Runs all unit tests
- Runs all integration tests
- Runs specific functionality tests
- Runs regression tests
- Provides detailed output with colors

### Test Specific Functionality
```bash
# Test Gradle dependency updates
npm test -- test/unit/GradleFileParser.test.ts --testNamePattern="should update direct dependency version correctly"

# Test Maven dependency updates
npm test -- test/unit/MavenFileParser.test.ts --testNamePattern="should update direct dependency version correctly"

# Test full workflow
npm test -- test/integration/VulnerabilityFixer.integration.test.ts --testNamePattern="should fix Gradle dependencies correctly"
```

## Test Data

The tests use realistic dependency data based on the actual screenshot showing successful Gradle updates:

### Gradle Test Data
```gradle
plugins {
    id 'org.springframework.boot' version '3.1.1'
}

dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
    implementation 'commons-io:commons-io:2.8.0'
    implementation 'org.springframework.security:spring-security-core:6.0.0'
    implementation 'org.springframework.boot:spring-boot:3.1.1'
}
```

### Expected Updates
- Spring Boot plugin: `3.1.1` → `3.1.11`
- spring-web: `6.0.0` → `6.1.8`
- commons-io: `2.8.0` → `2.14.0`
- spring-security-core: `6.0.0` → `6.1.8`
- spring-boot: `3.1.1` → `${springBootVersion}`

### Maven Test Data
```xml
<project>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.1.1</version>
    </parent>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-web</artifactId>
            <version>6.0.0</version>
        </dependency>
    </dependencies>
</project>
```

## Preventing Regressions

These tests are designed to prevent the regression that occurred when working on Maven functionality broke Gradle functionality. The tests ensure:

1. **Gradle functionality remains intact** - All Gradle dependency updates work correctly
2. **Maven functionality works** - All Maven dependency updates work correctly
3. **Mixed scenarios work** - Both package managers can be used in the same analysis
4. **Comments are generated** - Proper CVE comments are added to files
5. **Error handling works** - Graceful handling of missing dependencies

## Continuous Integration

These tests should be run:

- ✅ **Before every commit** - Ensure no regressions
- ✅ **After dependency updates** - Ensure compatibility
- ✅ **Before releases** - Full regression testing
- ✅ **After refactoring** - Ensure functionality is preserved

## Troubleshooting

### Common Issues

1. **Tests fail with "Cannot find module"**
   - Run `npm install` to install dependencies
   - Run `npm run build` to compile TypeScript

2. **Tests timeout**
   - Increase timeout in `test/setup.ts`
   - Check for infinite loops in test code

3. **Mock issues**
   - Check that mocks are properly set up in `test/setup.ts`
   - Ensure test utilities are working correctly

### Debugging Tests

```bash
# Run tests with verbose output
npm test -- --verbose

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch
```

## Adding New Tests

When adding new functionality:

1. **Add unit tests** for the specific component
2. **Add integration tests** for the full workflow
3. **Update test data** if needed
4. **Run all tests** to ensure no regressions
5. **Update this README** with new test information

## Test Maintenance

- Keep test data up to date with current dependency versions
- Update tests when adding new package manager support
- Ensure tests reflect real-world usage scenarios
- Maintain test coverage above 80% 
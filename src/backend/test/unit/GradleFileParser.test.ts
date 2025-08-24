import { describe, it, expect, beforeEach } from '@jest/globals';
import { GradleFileParser } from '../../src/services/fileParser/GradleFileParser';

describe('GradleFileParser', () => {
  let parser: GradleFileParser;

  beforeEach(() => {
    parser = new GradleFileParser();
  });

  describe('updateDependencyVersion', () => {
    it('should update direct dependency version correctly', async () => {
      const content = `
plugins {
    id 'org.springframework.boot' version '3.1.1'
}

dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
    implementation 'commons-io:commons-io:2.8.0'
    implementation 'org.springframework.security:spring-security-core:6.0.0'
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework:spring-web',
        '6.0.0',
        '6.1.8',
        'CVE-2023-1234',
        'Security update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain("implementation 'org.springframework:spring-web:6.1.8'");
      expect(modifiedContent).toContain("// CVE-2023-1234: Security update");
    });

    it('should update Spring Boot dependency version correctly', async () => {
      const content = `
dependencies {
    implementation 'org.springframework.boot:spring-boot:3.1.1'
    implementation 'io.spring.dependency-management:spring-dependency-management:1.0.11.RELEASE'
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework.boot:spring-boot',
        '3.1.1',
        '3.1.11',
        'CVE-2023-4567',
        'Spring Boot security update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain("implementation 'org.springframework.boot:spring-boot:3.1.11'");
      expect(modifiedContent).toContain("// CVE-2023-4567: Spring Boot security update");
    });

    it('should update dependency with variable version', async () => {
      const content = `
dependencies {
    implementation "org.springframework.boot:spring-boot:3.1.1"
    implementation "org.springframework:spring-web:6.0.0"
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework.boot:spring-boot',
        '3.1.1',
        '${springBootVersion}',
        'CVE-2023-7890',
        'Use variable version'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('implementation "org.springframework.boot:spring-boot:${springBootVersion}"');
      expect(modifiedContent).toContain("// CVE-2023-7890: Use variable version");
    });

    it('should handle dependencies with different quote styles', async () => {
      const content = `
dependencies {
    implementation("commons-io:commons-io:2.8.0")
    implementation 'org.springframework:spring-web:6.0.0'
    implementation "org.springframework.security:spring-security-core:6.0.0"
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.updateDependencyVersion(
        modification,
        'commons-io:commons-io',
        '2.8.0',
        '2.14.0',
        'CVE-2023-1111',
        'Commons IO security update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('implementation("commons-io:commons-io:2.14.0")');
      expect(modifiedContent).toContain("// CVE-2023-1111: Commons IO security update");
    });

    it('should handle dependencies with spaces around version', async () => {
      const content = `
dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
    implementation 'commons-io:commons-io:2.8.0'
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework:spring-web',
        '6.0.0',
        '6.1.8',
        'CVE-2023-2222',
        'Spring Web update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain("implementation 'org.springframework:spring-web:6.1.8'");
    });

    it('should return false when dependency not found', async () => {
      const content = `
dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.updateDependencyVersion(
        modification,
        'nonexistent:dependency',
        '1.0.0',
        '2.0.0',
        'CVE-2023-3333',
        'Test'
      );

      expect(result).toBe(false);
    });

    it('should handle multiple dependencies with same name but different versions', async () => {
      const content = `
dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
    testImplementation 'org.springframework:spring-web:5.3.0'
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework:spring-web',
        '6.0.0',
        '6.1.8',
        'CVE-2023-4444',
        'Spring Web production update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain("implementation 'org.springframework:spring-web:6.1.8'");
      expect(modifiedContent).toContain("testImplementation 'org.springframework:spring-web:5.3.0'"); // Should not change
    });
  });

  describe('addDependencyConstraint', () => {
    it('should add dependency constraint correctly', async () => {
      const content = `
dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
}

configurations.all {
    resolutionStrategy {
        force 'org.springframework:spring-web:6.0.0'
    }
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.addDependencyConstraint(
        modification,
        'org.springframework:spring-web',
        '6.1.8',
        'CVE-2023-5555',
        'Force Spring Web version'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain("implementation('org.springframework:spring-web:6.1.8')");
      expect(modifiedContent).toContain("// CVE-2023-5555: Force Spring Web version");
    });

    it('should add dependency constraint when resolutionStrategy block exists', async () => {
      const content = `
dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
}

configurations.all {
    resolutionStrategy {
        force 'org.springframework:spring-web:6.0.0'
    }
}
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('build.gradle', content);

      const result = parser.addDependencyConstraint(
        modification,
        'commons-io:commons-io',
        '2.14.0',
        'CVE-2023-6666',
        'Force Commons IO version'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain("implementation('commons-io:commons-io:2.14.0')");
      expect(modifiedContent).toContain("// CVE-2023-6666: Force Commons IO version");
    });
  });

  describe('parseFile', () => {
    it('should parse Gradle file correctly', async () => {
      const content = `
plugins {
    id 'org.springframework.boot' version '3.1.1'
}

dependencies {
    implementation 'org.springframework:spring-web:6.0.0'
    implementation 'commons-io:commons-io:2.8.0'
    implementation 'org.springframework.security:spring-security-core:6.0.0'
    testImplementation 'org.springframework.boot:spring-boot-starter-test:3.1.1'
}
`;

      const result = await parser.parseFile('build.gradle', content);

      expect(result.dependencies).toHaveLength(4);
      expect(result.dependencies.find(d => d.name === 'spring-web')).toBeDefined();
      expect(result.dependencies.find(d => d.name === 'commons-io')).toBeDefined();
      expect(result.dependencies.find(d => d.name === 'spring-security-core')).toBeDefined();
      expect(result.dependencies.find(d => d.name === 'spring-boot-starter-test')).toBeDefined();
    });
  });
}); 
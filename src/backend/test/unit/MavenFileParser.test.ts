import { describe, it, expect, beforeEach } from '@jest/globals';
import { MavenFileParser } from '../../src/services/fileParser/MavenFileParser';

describe('MavenFileParser', () => {
  let parser: MavenFileParser;

  beforeEach(() => {
    parser = new MavenFileParser();
  });

  describe('updateDependencyVersion', () => {
    it('should update direct dependency version correctly', async () => {
      const content = `
<project>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-web</artifactId>
            <version>6.0.0</version>
        </dependency>
        <dependency>
            <groupId>commons-io</groupId>
            <artifactId>commons-io</artifactId>
            <version>2.8.0</version>
        </dependency>
    </dependencies>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

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
      expect(modifiedContent).toContain('<version>6.1.8</version>');
      expect(modifiedContent).toContain('<!-- CVE-2023-1234: Security update -->');
    });

    it('should update dependency with property version', async () => {
      const content = `
<project>
    <properties>
        <spring.version>6.0.0</spring.version>
        <commons-io.version>2.8.0</commons-io.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-web</artifactId>
            <version>\${spring.version}</version>
        </dependency>
        <dependency>
            <groupId>commons-io</groupId>
            <artifactId>commons-io</artifactId>
            <version>\${commons-io.version}</version>
        </dependency>
    </dependencies>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework:spring-web',
        '6.0.0',
        '6.1.8',
        'CVE-2023-4567',
        'Spring Web security update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('<spring.version>6.1.8</spring.version>');
      expect(modifiedContent).toContain('<!-- CVE-2023-4567: Spring Web security update -->');
    });

    it('should update Spring Boot dependency version', async () => {
      const content = `
<project>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-parent</artifactId>
            <version>3.1.1</version>
        </dependency>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-web</artifactId>
        </dependency>
    </dependencies>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework.boot:spring-boot-starter-parent',
        '3.1.1',
        '3.1.11',
        'CVE-2023-7890',
        'Spring Boot dependency update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('<version>3.1.11</version>');
      expect(modifiedContent).toContain('<!-- CVE-2023-7890: Spring Boot dependency update -->');
    });

    it('should handle dependencies with different formatting', async () => {
      const content = `
<project>
    <dependencies>
        <dependency>
            <groupId>org.springframework.security</groupId>
            <artifactId>spring-security-core</artifactId>
            <version>6.0.0</version>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot</artifactId>
            <version>3.1.1</version>
        </dependency>
    </dependencies>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework.security:spring-security-core',
        '6.0.0',
        '6.1.8',
        'CVE-2023-1111',
        'Spring Security update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('<version>6.1.8</version>');
      expect(modifiedContent).toContain('<!-- CVE-2023-1111: Spring Security update -->');
    });

    it('should return false when dependency not found', async () => {
      const content = `
<project>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-web</artifactId>
            <version>6.0.0</version>
        </dependency>
    </dependencies>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

      const result = parser.updateDependencyVersion(
        modification,
        'nonexistent:dependency',
        '1.0.0',
        '2.0.0',
        'CVE-2023-2222',
        'Test'
      );

      expect(result).toBe(false);
    });

    it('should handle dependency management section', async () => {
      const content = `
<project>
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework</groupId>
                <artifactId>spring-web</artifactId>
                <version>6.0.0</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-web</artifactId>
        </dependency>
    </dependencies>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

      const result = parser.updateDependencyVersion(
        modification,
        'org.springframework:spring-web',
        '6.0.0',
        '6.1.8',
        'CVE-2023-3333',
        'Dependency management update'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('<version>6.1.8</version>');
      expect(modifiedContent).toContain('<!-- CVE-2023-3333: Dependency management update -->');
    });
  });

  describe('addDependencyManagement', () => {
    it('should add dependency management correctly', async () => {
      const content = `
<project>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-web</artifactId>
            <version>6.0.0</version>
        </dependency>
    </dependencies>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

      const result = parser.addDependencyManagement(
        modification,
        'commons-io',
        'commons-io',
        '2.14.0',
        'CVE-2023-4444',
        'Add Commons IO management'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('<dependencyManagement>');
      expect(modifiedContent).toContain('<groupId>commons-io</groupId>');
      expect(modifiedContent).toContain('<artifactId>commons-io</artifactId>');
      expect(modifiedContent).toContain('<version>2.14.0</version>');
      expect(modifiedContent).toContain('<!-- CVE-2023-4444: Add Commons IO management -->');
    });

    it('should add to existing dependency management section', async () => {
      const content = `
<project>
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework</groupId>
                <artifactId>spring-web</artifactId>
                <version>6.0.0</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
</project>
`;

      // First parse the file to get dependencies
      const modification = await parser.parseFile('pom.xml', content);

      const result = parser.addDependencyManagement(
        modification,
        'commons-io',
        'commons-io',
        '2.14.0',
        'CVE-2023-5555',
        'Add to existing management'
      );

      expect(result).toBe(true);
      
      // Get the modified content
      const modifiedContent = parser.getModifiedContent(modification);
      expect(modifiedContent).toContain('<groupId>commons-io</groupId>');
      expect(modifiedContent).toContain('<artifactId>commons-io</artifactId>');
      expect(modifiedContent).toContain('<version>2.14.0</version>');
    });
  });

  describe('parseFile', () => {
    it('should parse Maven file correctly', async () => {
      const content = `
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
        <dependency>
            <groupId>commons-io</groupId>
            <artifactId>commons-io</artifactId>
            <version>2.8.0</version>
        </dependency>
    </dependencies>
</project>
`;

      const result = await parser.parseFile('pom.xml', content);

      expect(result.dependencies).toHaveLength(2); // Only dependencies, not parent
      expect(result.dependencies.find(d => d.artifactId === 'spring-web')).toBeDefined();
      expect(result.dependencies.find(d => d.artifactId === 'commons-io')).toBeDefined();
    });
  });
}); 
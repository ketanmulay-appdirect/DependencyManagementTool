import { logger } from '../../utils/logger';
import { parseStringPromise, Builder } from 'xml2js';

export interface MavenDependency {
  groupId: string;
  artifactId: string;
  version: string;
  scope?: string;
  lineNumber?: number;
  isProperty: boolean;
  propertyName?: string;
  originalXml: string;
}

export interface MavenProperty {
  name: string;
  value: string;
  lineNumber?: number;
  originalXml: string;
}

export interface MavenFileModification {
  filePath: string;
  dependencies: MavenDependency[];
  properties: MavenProperty[];
  content: string;
  parsedXml: any;
  modifications: Array<{
    type: 'dependency' | 'property' | 'dependencyManagement';
    xpath: string;
    oldValue: string;
    newValue: string;
    comment: string;
    cveId?: string;
  }>;
}

export class MavenFileParser {
  
  /**
   * Parse a Maven POM file and extract dependencies and properties
   */
  async parseFile(filePath: string, content: string): Promise<MavenFileModification> {
    logger.info(`🔍 Parsing Maven POM file: ${filePath}`);
    
    try {
      // Parse XML
      const parsedXml = await parseStringPromise(content);
      const project = parsedXml.project || {};
      
      const dependencies: MavenDependency[] = [];
      const properties: MavenProperty[] = [];
      const modifications: MavenFileModification['modifications'] = [];

      // Extract properties
      if (project.properties && project.properties[0]) {
        Object.keys(project.properties[0]).forEach(propName => {
          const propValue = project.properties[0][propName][0];
          properties.push({
            name: propName,
            value: propValue,
            originalXml: `<${propName}>${propValue}</${propName}>`
          });
        });
      }

      // Extract dependencies from <dependencies> section
      if (project.dependencies && project.dependencies[0] && project.dependencies[0].dependency) {
        project.dependencies[0].dependency.forEach((dep: any) => {
          const dependency = this.parseDependency(dep, properties);
          if (dependency) {
            dependencies.push(dependency);
          }
        });
      }

      // Extract dependencies from <dependencyManagement> section
      if (project.dependencyManagement && 
          project.dependencyManagement[0] && 
          project.dependencyManagement[0].dependencies && 
          project.dependencyManagement[0].dependencies[0] &&
          project.dependencyManagement[0].dependencies[0].dependency) {
        
        project.dependencyManagement[0].dependencies[0].dependency.forEach((dep: any) => {
          const dependency = this.parseDependency(dep, properties);
          if (dependency) {
            dependency.scope = 'dependencyManagement';
            dependencies.push(dependency);
          }
        });
      }

      logger.info(`📦 Found ${dependencies.length} dependencies and ${properties.length} properties in ${filePath}`);

      return {
        filePath,
        dependencies,
        properties,
        content,
        parsedXml,
        modifications
      };
    } catch (error) {
      logger.error(`❌ Failed to parse Maven POM file ${filePath}:`, error);
      throw new Error(`Invalid POM file: ${error}`);
    }
  }

  /**
   * Parse a single dependency
   */
  private parseDependency(dep: any, properties: MavenProperty[]): MavenDependency | null {
    if (!dep.groupId || !dep.artifactId) {
      return null;
    }

    const groupId = dep.groupId[0];
    const artifactId = dep.artifactId[0];
    const versionPart = dep.version ? dep.version[0] : '';
    const scope = dep.scope ? dep.scope[0] : undefined;

    // Check if version uses a property
    const propertyMatch = versionPart.match(/^\$\{([^}]+)\}$/);
    if (propertyMatch) {
      const propertyName = propertyMatch[1];
      const property = properties.find(p => p.name === propertyName);
      const resolvedVersion = property ? property.value : versionPart;
      
      return {
        groupId,
        artifactId,
        version: resolvedVersion,
        scope,
        isProperty: true,
        propertyName,
        originalXml: this.dependencyToXml(dep)
      };
    } else {
      return {
        groupId,
        artifactId,
        version: versionPart,
        scope,
        isProperty: false,
        originalXml: this.dependencyToXml(dep)
      };
    }
  }

  /**
   * Convert dependency object back to XML string
   */
  private dependencyToXml(dep: any): string {
    const builder = new Builder({ headless: true, renderOpts: { pretty: false } });
    return builder.buildObject({ dependency: dep });
  }

  /**
   * Update a dependency version in the Maven POM
   */
  updateDependencyVersion(
    modification: MavenFileModification,
    dependencyName: string,
    currentVersion: string,
    newVersion: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🔄 Updating ${dependencyName} from ${currentVersion} to ${newVersion} for ${cveId}`);

    // Find the dependency to update with strict matching
    // Handle both full coordinates (group:artifact) and just artifact name
    let dependency: MavenDependency | undefined;
    
    if (dependencyName.includes(':')) {
      // Full coordinates provided (e.g., "com.google.code.gson:gson")
      const [groupId, artifactId] = dependencyName.split(':');
      dependency = modification.dependencies.find(dep => 
        dep.groupId === groupId && dep.artifactId === artifactId
      );
    } else {
      // Only artifact name provided (e.g., "gson")
      // Use exact match only to prevent partial matches like "feign-gson" matching "gson"
      dependency = modification.dependencies.find(dep => 
        dep.artifactId === dependencyName
      );
    }

    if (!dependency) {
      logger.warn(`❌ Dependency ${dependencyName} not found in Maven POM`);
      return false;
    }

    if (dependency.isProperty && dependency.propertyName) {
      // Update the property instead of the dependency
      return this.updateProperty(modification, dependency.propertyName, currentVersion, newVersion, cveId, reason);
    } else {
      // Update the dependency version directly
      return this.updateDependencyDirectly(modification, dependency, currentVersion, newVersion, cveId, reason);
    }
  }

  /**
   * Update a property value
   */
  private updateProperty(
    modification: MavenFileModification,
    propertyName: string,
    currentValue: string,
    newValue: string,
    cveId: string,
    reason: string
  ): boolean {
    const property = modification.properties.find(p => p.name === propertyName);
    if (!property) {
      logger.warn(`❌ Property ${propertyName} not found`);
      return false;
    }

    // Update in parsed XML
    if (modification.parsedXml.project.properties && 
        modification.parsedXml.project.properties[0] &&
        modification.parsedXml.project.properties[0][propertyName]) {
      modification.parsedXml.project.properties[0][propertyName][0] = newValue;
    }

    // Add comment to XML
    const comment = `<!-- ${cveId}: ${reason} -->`;
    const lines = modification.content.split('\n');
    
    // Find the property line and add comment above it
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`<${propertyName}>${currentValue}</${propertyName}>`)) {
        lines.splice(i, 0, `        ${comment}`);
        lines[i + 1] = lines[i + 1].replace(currentValue, newValue);
        break;
      }
    }

    modification.modifications.push({
      type: 'property',
      xpath: `/project/properties/${propertyName}`,
      oldValue: currentValue,
      newValue: newValue,
      comment,
      cveId
    });

    modification.content = lines.join('\n');
    logger.info(`✅ Updated property ${propertyName}: ${currentValue} → ${newValue}`);
    return true;
  }

  /**
   * Update dependency version directly
   */
  private updateDependencyDirectly(
    modification: MavenFileModification,
    dependency: MavenDependency,
    currentVersion: string,
    newVersion: string,
    cveId: string,
    reason: string
  ): boolean {
    // Update in parsed XML
    const deps = dependency.scope === 'dependencyManagement' 
      ? modification.parsedXml.project.dependencyManagement[0].dependencies[0].dependency
      : modification.parsedXml.project.dependencies[0].dependency;

    const targetDep = deps.find((dep: any) => 
      dep.groupId[0] === dependency.groupId && dep.artifactId[0] === dependency.artifactId
    );

    if (targetDep && targetDep.version) {
      targetDep.version[0] = newVersion;
    }

    // Add comment to XML content
    const comment = `        <!-- ${cveId}: ${reason} -->`;
    const lines = modification.content.split('\n');
    
    // Find the dependency and add comment
    let inTargetDependency = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes(`<groupId>${dependency.groupId}</groupId>`)) {
        inTargetDependency = true;
      }
      
      if (inTargetDependency && line.includes(`<version>${currentVersion}</version>`)) {
        // Only add comment if CVE ID is provided
        if (cveId && cveId.trim()) {
          lines.splice(i, 0, comment);
          lines[i + 1] = line.replace(currentVersion, newVersion);
        } else {
          lines[i] = line.replace(currentVersion, newVersion);
        }
        break;
      }
      
      if (inTargetDependency && line.includes('</dependency>')) {
        inTargetDependency = false;
      }
    }

    modification.modifications.push({
      type: 'dependency',
      xpath: `/project/dependencies/dependency[groupId='${dependency.groupId}' and artifactId='${dependency.artifactId}']/version`,
      oldValue: currentVersion,
      newValue: newVersion,
      comment,
      cveId
    });

    modification.content = lines.join('\n');
    logger.info(`✅ Updated dependency ${dependency.groupId}:${dependency.artifactId}: ${currentVersion} → ${newVersion}`);
    return true;
  }

  /**
   * Add dependency management entry for transitive dependency override
   */
  addDependencyManagement(
    modification: MavenFileModification,
    groupId: string,
    artifactId: string,
    version: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🎯 Adding dependency management for ${groupId}:${artifactId}:${version} (${cveId})`);

    // Ensure dependencyManagement section exists
    if (!modification.parsedXml.project.dependencyManagement) {
      modification.parsedXml.project.dependencyManagement = [{ dependencies: [{ dependency: [] }] }];
    }

    if (!modification.parsedXml.project.dependencyManagement[0].dependencies) {
      modification.parsedXml.project.dependencyManagement[0].dependencies = [{ dependency: [] }];
    }

    // Add new dependency to dependencyManagement
    const newDep = {
      groupId: [groupId],
      artifactId: [artifactId],
      version: [version]
    };

    modification.parsedXml.project.dependencyManagement[0].dependencies[0].dependency.push(newDep);

    // Add to content with comment
    const comment = `        <!-- ${cveId}: ${reason} -->`;
    const dependencyXml = `        <dependency>
            <groupId>${groupId}</groupId>
            <artifactId>${artifactId}</artifactId>
            <version>${version}</version>
        </dependency>`;

    const lines = modification.content.split('\n');
    
    // Find dependencyManagement section or create it
    let dependencyMgmtIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('<dependencyManagement>')) {
        // Find the dependencies section within dependencyManagement
        for (let j = i; j < lines.length; j++) {
          if (lines[j].includes('</dependencies>') && lines[j + 1].includes('</dependencyManagement>')) {
            dependencyMgmtIndex = j;
            break;
          }
        }
        break;
      }
    }

    if (dependencyMgmtIndex !== -1) {
      lines.splice(dependencyMgmtIndex, 0, comment, dependencyXml);
    } else {
      // Create dependencyManagement section
      const projectEndIndex = lines.findIndex(line => line.includes('</project>'));
      if (projectEndIndex !== -1) {
        const dependencyMgmtSection = `
    <dependencyManagement>
        <dependencies>
${comment}
${dependencyXml}
        </dependencies>
    </dependencyManagement>`;
        lines.splice(projectEndIndex, 0, dependencyMgmtSection);
      }
    }

    modification.modifications.push({
      type: 'dependencyManagement',
      xpath: `/project/dependencyManagement/dependencies/dependency[groupId='${groupId}' and artifactId='${artifactId}']`,
      oldValue: '',
      newValue: `${groupId}:${artifactId}:${version}`,
      comment,
      cveId
    });

    modification.content = lines.join('\n');
    logger.info(`✅ Added dependency management for ${groupId}:${artifactId}`);
    return true;
  }

  /**
   * Get the final modified content
   */
  getModifiedContent(modification: MavenFileModification): string {
    // Safety check for undefined or null content
    if (!modification.content) {
      logger.error(`❌ No content available for ${modification.filePath}`);
      return '';
    }
    
    // For now, return the modified content directly since the xml2js reconstruction
    // seems to be causing issues. The content should already be properly modified
    // by the string-based operations in the update methods.
    
    // Check for project tag with more flexible matching (handle attributes)
    const projectTagPattern = /<project[^>]*>/;
    if (!projectTagPattern.test(modification.content)) {
      logger.error(`❌ Modified content missing <project> tag for ${modification.filePath}`);
      logger.error(`📄 Content preview: ${modification.content.substring(0, 500)}...`);
      // Instead of throwing an error, return the original content to prevent crashes
      logger.warn(`⚠️ Returning original content for ${modification.filePath} due to missing <project> tag`);
      return modification.content;
    }
    
    logger.info(`✅ Returning modified content for ${modification.filePath}`);
    return modification.content;
  }

  /**
   * Get summary of changes made
   */
  getChangesSummary(modification: MavenFileModification): string {
    const summary = modification.modifications.map(mod => {
      switch (mod.type) {
        case 'dependency':
          return `• Updated dependency version: ${mod.oldValue} → ${mod.newValue}`;
        case 'property':
          return `• Updated version property: ${mod.oldValue} → ${mod.newValue}`;
        case 'dependencyManagement':
          return `• Added dependency management override: ${mod.newValue}`;
        default:
          return `• Made change: ${mod.oldValue} → ${mod.newValue}`;
      }
    }).join('\n');

    return `Changes made to ${modification.filePath}:\n${summary}`;
  }

  /**
   * Add informational comments about transitive dependencies covered by parent updates
   * Only called when dependency management is actually added to a file
   */
  addTransitiveDependencyComments(
    modification: MavenFileModification,
    comments: string[]
  ): boolean {
    if (!comments || comments.length === 0) {
      return false;
    }

    const lines = modification.content.split('\n');
    
    // Find the project tag to add comments after
    let projectStartIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('<project')) {
        projectStartIndex = i;
        break;
      }
    }

    if (projectStartIndex === -1) {
      logger.error(`❌ Could not find project tag in Maven POM file`);
      return false;
    }

    // Detect indentation for consistent formatting
    const projectIndentation = lines[projectStartIndex].match(/^(\s*)/)?.[1] || '  ';

    // Add comments after the project tag
    const commentLines = [
      '',
      `${projectIndentation}<!-- =============================================== -->`,
      `${projectIndentation}<!-- Transitive Dependencies Covered by Parent Updates -->`,
      `${projectIndentation}<!-- =============================================== -->`
    ];

    comments.forEach(comment => {
      commentLines.push(`${projectIndentation}<!-- ${comment} -->`);
    });

    commentLines.push(`${projectIndentation}<!-- =============================================== -->`);
    commentLines.push('');

    // Insert comments after project tag
    lines.splice(projectStartIndex + 1, 0, ...commentLines);

    modification.content = lines.join('\n');
    modification.modifications.push({
      type: 'comment' as any,
      xpath: '/project/transitive-dependencies-comment',
      oldValue: '',
      newValue: commentLines.join('\n'),
      comment: 'Added transitive dependency information',
      cveId: 'INFO'
    });

    logger.info(`✅ Added ${comments.length} transitive dependency comments to Maven POM file`);
    return true;
  }
} 
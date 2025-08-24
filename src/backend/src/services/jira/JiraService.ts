import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import { 
  JiraConfig, 
  JiraTicket, 
  WizFinding, 
  VulnerabilitySeverity 
} from '../../types';

export class JiraService {
  private client: AxiosInstance;
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
    
    // Create axios instance with authentication - start with API v2 for better compatibility
    this.client = axios.create({
      baseURL: `${config.baseUrl}/rest/api/2`,
      auth: {
        username: config.email,
        password: config.token,
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('JIRA API error:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url,
          baseURL: error.config?.baseURL,
        });
        throw error;
      }
    );
  }

  /**
   * Validate JIRA connection and credentials
   */
  async validateConnection(): Promise<boolean> {
    try {
      logger.info('Validating JIRA connection', {
        baseUrl: this.config.baseUrl,
        apiEndpoint: `${this.config.baseUrl}/rest/api/2`,
        email: this.config.email,
      });
      
      const response = await this.client.get('/myself');
      
      logger.info('JIRA connection validated successfully', {
        user: response.data.displayName,
        accountId: response.data.accountId,
        email: response.data.emailAddress,
      });
      
      return true;
    } catch (error: any) {
      logger.error('JIRA connection validation failed:', {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
      });
      throw new Error(`JIRA connection failed: ${error.message}`);
    }
  }

  /**
   * Fetch multiple JIRA tickets by their keys
   */
  async getTickets(ticketKeys: string[]): Promise<JiraTicket[]> {
    try {
      if (!ticketKeys || ticketKeys.length === 0) {
        return [];
      }

      logger.info(`Fetching JIRA tickets: ${ticketKeys.join(', ')}`);

      const tickets: JiraTicket[] = [];

      // Fetch tickets in parallel
      const ticketPromises = ticketKeys.map(async (key) => {
        try {
          return await this.getTicket(key);
        } catch (error) {
          logger.warn(`Failed to fetch ticket ${key}:`, error);
          return null;
        }
      });

      const results = await Promise.all(ticketPromises);
      
      for (const ticket of results) {
        if (ticket) {
          tickets.push(ticket);
        }
      }

      logger.info(`Successfully fetched ${tickets.length} out of ${ticketKeys.length} tickets`);
      return tickets;
    } catch (error: any) {
      logger.error('Error fetching JIRA tickets:', error);
      throw new Error(`Failed to fetch JIRA tickets: ${error.message}`);
    }
  }

  /**
   * Fetch a single JIRA ticket by key
   */
  async getTicket(ticketKey: string): Promise<JiraTicket> {
    try {
      logger.info(`Fetching JIRA ticket: ${ticketKey}`);

      const response = await this.client.get(`/issue/${ticketKey}`, {
        params: {
          expand: 'changelog,attachments,comments',
          fields: 'summary,description,status,priority,assignee,reporter,created,updated,labels,customfield_*',
        },
      });

      const issue = response.data;
      
      // Parse Wiz findings from the ticket
      const wizFindings = this.parseWizFindings(issue);

      const ticket: JiraTicket = {
        id: issue.id,
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description?.content?.[0]?.content?.[0]?.text || 
                    issue.fields.description || '',
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'Medium',
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName || 'Unknown',
        createdAt: new Date(issue.fields.created),
        updatedAt: new Date(issue.fields.updated),
        wizFindings,
      };

              logger.info(`Successfully fetched ticket ${ticketKey}`, {
          summary: ticket.summary,
          status: ticket.status,
          priority: ticket.priority,
          wizFindingsCount: wizFindings.length,
        });

        // Log detailed parsing results for debugging
        if (wizFindings.length > 0) {
          wizFindings.forEach((finding, index) => {
            logger.info(`Parsed finding ${index + 1} from ${ticketKey}:`, {
              title: finding.title,
              cveIds: finding.cveIds,
              affectedPackages: finding.affectedPackages,
              recommendedActions: finding.recommendedActions,
              severity: finding.severity,
            });
          });
        }
        
        // Always log the description content for debugging VM tickets
        logger.info(`VM Ticket ${ticketKey} description content:`, {
          ticketKey: issue.key,
          descriptionLength: ticket.description.length,
          fullDescription: ticket.description,
          rawDescriptionType: typeof issue.fields.description,
          hasAdfContent: !!(issue.fields.description?.content),
        });

      return ticket;
    } catch (error: any) {
      logger.error(`Error fetching JIRA ticket ${ticketKey}:`, error);
      
      if (error.response?.status === 404) {
        throw new Error(`JIRA ticket ${ticketKey} not found`);
      } else if (error.response?.status === 401) {
        throw new Error('JIRA authentication failed');
      } else if (error.response?.status === 403) {
        throw new Error(`No permission to access JIRA ticket ${ticketKey}`);
      }
      
      throw new Error(`Failed to fetch JIRA ticket ${ticketKey}: ${error.message}`);
    }
  }

  /**
   * Parse Wiz security findings from JIRA ticket
   */
  private parseWizFindings(issue: any): WizFinding[] {
    const findings: WizFinding[] = [];

    try {
      logger.info(`🔍 PARSING TICKET ${issue.key} for WizFindings:`);
      
      // Parse description for Wiz findings
      const description = this.extractTextFromDescription(issue.fields.description);
      
      logger.info(`📄 Description extracted (${description.length} chars):`, {
        preview: description.substring(0, 300) + (description.length > 300 ? '...' : ''),
        hasDescription: !!description,
      });
      
      // Look for CVEs in structured format first, then fallback to pattern matching
      let cveMatches: string[] = [];
      
      // Extract from "Affected Vulnerabilities:" section
      const affectedVulnMatch = description.match(/Affected Vulnerabilities:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/i);
      if (affectedVulnMatch) {
        const vulnSection = affectedVulnMatch[1];
        cveMatches = vulnSection.match(/CVE-\d{4}-\d{4,}/g) || [];
        logger.info(`🎯 Found CVEs in Affected Vulnerabilities section: ${cveMatches.join(', ')}`);
      } else {
        // Fallback to general CVE pattern matching
        cveMatches = description.match(/CVE-\d{4}-\d{4,}/g) || [];
        logger.info(`🔍 Found CVEs via general pattern: ${cveMatches.join(', ')}`);
      }
      
      // Look for package names and versions
      const packageMatches = this.extractPackageInfo(description);
      logger.info(`📦 Found packages: ${packageMatches.join(', ')}`);
      
      // Parse severity from labels or custom fields
      const severity = this.extractSeverity(issue);
      logger.info(`⚠️ Extracted severity: ${severity}`);
      
      // Check if this is a Wiz ticket
      const isWizTicket = this.isWizTicket(issue);
      logger.info(`🏷️ Is Wiz ticket: ${isWizTicket}`);
      
      // Log criteria checks
      const hasVulnContent = cveMatches.length > 0 || packageMatches.length > 0;
      logger.info(`✅ Criteria check:`, {
        isWizTicket,
        hasVulnContent,
        cveCount: cveMatches.length,
        packageCount: packageMatches.length,
        willCreateFinding: isWizTicket || hasVulnContent
      });
      
      // Create a finding if this is a Wiz ticket or if we found vulnerability content
      if (isWizTicket) {
        logger.info(`✅ Creating Wiz finding for ticket ${issue.key} (WIZ TICKET):`, {
          ticketKey: issue.key,
          summary: issue.fields.summary,
          cveCount: cveMatches.length,
          packageCount: packageMatches.length,
          severity: severity,
          isWizTicket: true
        });

        const finding: WizFinding = {
          id: issue.id,
          title: issue.fields.summary,
          description: description,
          severity: severity,
          category: this.extractCategory(issue),
          resourceType: this.extractResourceType(description),
          resourceName: this.extractResourceName(description),
          cveIds: cveMatches,
          affectedPackages: packageMatches,
          recommendedActions: this.extractRecommendedActions(description),
          detectionDate: new Date(issue.fields.created),
        };

        findings.push(finding);
      } else if (cveMatches.length > 0 || packageMatches.length > 0) {
        logger.info(`✅ Creating finding for ticket ${issue.key} (HAS VULN CONTENT):`, {
          ticketKey: issue.key,
          summary: issue.fields.summary,
          cveCount: cveMatches.length,
          packageCount: packageMatches.length,
          severity: severity,
          isWizTicket: false
        });
        
        // Create finding for non-Wiz tickets that have vulnerability content
        const finding: WizFinding = {
          id: issue.id,
          title: issue.fields.summary,
          description: description,
          severity: severity,
          category: this.extractCategory(issue),
          resourceType: this.extractResourceType(description),
          resourceName: this.extractResourceName(description),
          cveIds: cveMatches,
          affectedPackages: packageMatches,
          recommendedActions: this.extractRecommendedActions(description),
          detectionDate: new Date(issue.fields.created),
        };

        findings.push(finding);
      } else {
        logger.warn(`❌ NO FINDING CREATED for ticket ${issue.key}:`, {
          reason: 'Not a Wiz ticket and no vulnerability content found',
          isWizTicket: false,
          cveCount: 0,
          packageCount: 0,
          summary: issue.fields.summary,
          descriptionPreview: description.substring(0, 200)
        });
      }
    } catch (error) {
      logger.error(`💥 Error parsing Wiz findings from ticket ${issue.key}:`, {
        error: error,
        summary: issue.fields.summary
      });
    }

    logger.info(`🎯 PARSING RESULT for ${issue.key}: ${findings.length} findings created`);
    return findings;
  }

  /**
   * Extract text content from JIRA description
   */
  private extractTextFromDescription(description: any): string {
    if (typeof description === 'string') {
      return description;
    }

    if (description?.content) {
      // Handle ADF (Atlassian Document Format)
      return this.extractTextFromADF(description);
    }

    return '';
  }

  /**
   * Extract text from Atlassian Document Format (comprehensive extraction)
   */
  private extractTextFromADF(adfContent: any): string {
    let text = '';

    const extractTextRecursive = (node: any): void => {
      if (!node) return;

      // Extract text nodes directly
      if (node.type === 'text' && node.text) {
        text += node.text + ' ';
        return;
      }

      // Handle code blocks - extract content but clean up formatting
      if (node.type === 'codeBlock') {
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            extractTextRecursive(child);
          }
        }
        text += '\n';
        return;
      }

      // Handle different block types
      if (node.type === 'paragraph' || 
          node.type === 'blockquote' ||
          node.type === 'bulletList' ||
          node.type === 'orderedList' ||
          node.type === 'listItem' ||
          node.type === 'heading') {
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            extractTextRecursive(child);
          }
        }
        // Add line breaks after block elements
        if (node.type === 'paragraph' || node.type === 'heading') {
          text += '\n';
        }
      }

      // Handle other content arrays
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) {
          extractTextRecursive(child);
        }
      }

      // Handle marks (bold, italic, etc.) - marks themselves don't contain text
      if (node.marks && Array.isArray(node.marks)) {
        // Marks modify the presentation but don't contain text
        // The text is in the content, so we don't need to process marks recursively
      }
    };

    if (Array.isArray(adfContent.content)) {
      for (const block of adfContent.content) {
        extractTextRecursive(block);
      }
    } else {
      extractTextRecursive(adfContent);
    }

    // Clean up the extracted text
    let cleanText = text.trim();
    
    // Clean up common formatting artifacts
    cleanText = this.cleanJiraFormatting(cleanText);

    return cleanText;
  }

  /**
   * Clean up JIRA formatting artifacts and markup
   */
  private cleanJiraFormatting(text: string): string {
    let cleaned = text;
    
    // Remove code block markers
    cleaned = cleaned.replace(/\{code(?::[^}]*)?\}/g, '');
    
    // Clean up bold markers (*text*) - remove asterisks around single words
    cleaned = cleaned.replace(/\*([^*\n]+)\*:/g, '$1:');
    cleaned = cleaned.replace(/\*([^*\n]{1,50})\*/g, '$1');
    
    // Clean up common JIRA markup
    cleaned = cleaned.replace(/\{color[^}]*\}/g, '');
    cleaned = cleaned.replace(/\{panel[^}]*\}/g, '');
    cleaned = cleaned.replace(/\{quote\}/g, '');
    cleaned = cleaned.replace(/\{noformat\}/g, '');
    
    // Clean up links [text|url] -> text
    cleaned = cleaned.replace(/\[([^\]|]+)\|[^\]]+\]/g, '$1');
    
    // Fix spacing around colons
    cleaned = cleaned.replace(/\s*:\s*/g, ': ');
    
    // Remove extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Add proper line breaks after key fields
    cleaned = cleaned.replace(/Component:/g, '\nComponent:');
    cleaned = cleaned.replace(/Recommended Version:/g, '\nRecommended Version:');
    cleaned = cleaned.replace(/Remediation Command:/g, '\nRemediation Command:');
    cleaned = cleaned.replace(/Asset:/g, '\nAsset:');
    cleaned = cleaned.replace(/Image ID:/g, '\nImage ID:');
    cleaned = cleaned.replace(/GH Repo:/g, '\nGH Repo:');
    cleaned = cleaned.replace(/Affected Vulnerabilities:/g, '\nAffected Vulnerabilities:');
    
    return cleaned.trim();
  }

  /**
   * Extract package information from description
   */
  private extractPackageInfo(description: string): string[] {
    const packages: string[] = [];
    
    // Parse structured VM ticket format - multiple variations
    const componentPatterns = [
      /Component:\s*([^\n\r]+)/i,
      /Package:\s*([^\n\r]+)/i,
      /Library:\s*([^\n\r]+)/i,
      /Dependency:\s*([^\n\r]+)/i,
      /Artifact:\s*([^\n\r]+)/i,
    ];

    for (const pattern of componentPatterns) {
      const match = description.match(pattern);
      if (match) {
        const component = match[1].trim();
        if (component && component !== 'N/A' && component !== '-') {
          packages.push(component);
        }
      }
    }

    // Also look in remediation commands for package names
    const remediationMatch = description.match(/mvn.*?-Dincludes=([^\s\n]+)/i);
    if (remediationMatch) {
      packages.push(remediationMatch[1].trim());
    }

    // Fallback to pattern matching for other formats
    const patterns = [
      // Maven coordinates: group:artifact:version or group:artifact
      /\b([a-zA-Z0-9.-]+):([a-zA-Z0-9.-]+)(?::([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*))?\b/g,
      // npm packages: package@version
      /@?\b([a-z0-9-_]+)@([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)\b/g,
      // Python packages: package==version
      /\b([a-zA-Z0-9-_]+)==([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)\b/g,
      // Go modules: module@version
      /\b([a-zA-Z0-9.-]+\/[a-zA-Z0-9.-\/]+)@v?([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)\b/g,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(description)) !== null) {
        if (match[1] && match[2]) {
          // For Maven coordinates, keep group:artifact format
          if (match[3]) {
            packages.push(`${match[1]}:${match[2]}`); // group:artifact
          } else {
            packages.push(`${match[1]}@${match[2]}`); // package@version
          }
        } else if (match[1] && pattern.source.includes('Maven')) {
          // Handle Maven coordinates without version
          packages.push(match[0]);
        }
      }
    }

    return [...new Set(packages)]; // Remove duplicates
  }

  /**
   * Extract severity from ticket
   */
  private extractSeverity(issue: any): VulnerabilitySeverity {
    // Check priority field
    const priority = issue.fields.priority?.name?.toLowerCase();
    if (priority) {
      if (priority.includes('critical') || priority.includes('highest')) {
        return 'critical';
      } else if (priority.includes('high')) {
        return 'high';
      } else if (priority.includes('medium')) {
        return 'medium';
      } else if (priority.includes('low') || priority.includes('lowest')) {
        return 'low';
      }
    }

    // Check labels
    const labels = issue.fields.labels || [];
    for (const label of labels) {
      const labelLower = label.toLowerCase();
      if (labelLower.includes('critical')) return 'critical';
      if (labelLower.includes('high')) return 'high';
      if (labelLower.includes('medium')) return 'medium';
      if (labelLower.includes('low')) return 'low';
    }

    // Check custom fields for severity
    for (const [key, value] of Object.entries(issue.fields)) {
      if (key.startsWith('customfield_') && value) {
        const valueStr = String(value).toLowerCase();
        if (valueStr.includes('critical')) return 'critical';
        if (valueStr.includes('high')) return 'high';
        if (valueStr.includes('medium')) return 'medium';
        if (valueStr.includes('low')) return 'low';
      }
    }

    // Default to medium if not specified
    return 'medium';
  }

  /**
   * Check if ticket is a Wiz security ticket
   */
  private isWizTicket(issue: any): boolean {
    const summary = issue.fields.summary?.toLowerCase() || '';
    const description = this.extractTextFromDescription(issue.fields.description).toLowerCase();
    const labels = issue.fields.labels || [];
    const project = issue.fields.project?.key || '';
    const ticketKey = issue.key || '';

    logger.info(`🏷️ CHECKING if ${ticketKey} is a Wiz ticket:`, {
      ticketKey,
      project,
      summary: summary.substring(0, 100),
      labelsCount: labels.length,
      labels: labels.slice(0, 5), // Log first 5 labels
      descriptionLength: description.length
    });

    // Check if it's a VM ticket (Vulnerability Management)
    if (ticketKey.startsWith('VM-')) {
      logger.info(`✅ ${ticketKey} is Wiz ticket: VM ticket prefix`);
      return true;
    }

    // Check if it's from the Wiz project
    if (project === this.config.projectKey) {
      logger.info(`✅ ${ticketKey} is Wiz ticket: project key match (${project})`);
      return true;
    }

    // Check description for structured VM ticket format
    const hasVMFormat = description.includes('component:') || 
        description.includes('recommended version:') || 
        description.includes('affected vulnerabilities:') ||
        description.includes('remediation command:');
    
    if (hasVMFormat) {
      logger.info(`✅ ${ticketKey} is Wiz ticket: has VM format in description`);
      return true;
    }

    // Check summary for Wiz keywords
    const wizKeywords = ['wiz', 'security', 'vulnerability', 'cve', 'dependency'];
    const summaryMatches = wizKeywords.filter(keyword => summary.includes(keyword));
    if (summaryMatches.length > 0) {
      logger.info(`✅ ${ticketKey} is Wiz ticket: summary contains keywords: ${summaryMatches.join(', ')}`);
      return true;
    }

    // Check labels for Wiz-related tags
    const wizLabels = labels.filter((label: string) => {
      const labelLower = label.toLowerCase();
      return labelLower.includes('wiz') || labelLower.includes('security') || labelLower.includes('vulnerability');
    });
    
    if (wizLabels.length > 0) {
      logger.info(`✅ ${ticketKey} is Wiz ticket: has Wiz labels: ${wizLabels.join(', ')}`);
      return true;
    }

    logger.info(`❌ ${ticketKey} is NOT a Wiz ticket:`, {
      reason: 'Failed all criteria',
      checkedCriteria: {
        vmPrefix: false,
        projectKey: `Expected: ${this.config.projectKey}, Actual: ${project}`,
        vmFormat: false,
        summaryKeywords: summaryMatches,
        wizLabels: wizLabels
      }
    });

    return false;
  }

  /**
   * Extract category from ticket
   */
  private extractCategory(issue: any): string {
    const labels = issue.fields.labels || [];
    
    // Look for category in labels
    for (const label of labels) {
      if (label.toLowerCase().includes('vulnerability')) return 'Vulnerability';
      if (label.toLowerCase().includes('dependency')) return 'Dependency';
      if (label.toLowerCase().includes('license')) return 'License';
      if (label.toLowerCase().includes('secrets')) return 'Secrets';
    }

    // Check issue type
    const issueType = issue.fields.issuetype?.name || '';
    if (issueType.toLowerCase().includes('security')) {
      return 'Security';
    }

    return 'Security';
  }

  /**
   * Extract resource type from description
   */
  private extractResourceType(description: string): string {
    const descLower = description.toLowerCase();
    
    if (descLower.includes('container') || descLower.includes('docker')) {
      return 'Container';
    } else if (descLower.includes('repository') || descLower.includes('repo')) {
      return 'Repository';
    } else if (descLower.includes('package') || descLower.includes('dependency')) {
      return 'Package';
    }

    return 'Code';
  }

  /**
   * Extract resource name from description
   */
  private extractResourceName(description: string): string {
    // Try to extract repository name
    const repoMatch = description.match(/repository[:\s]+([a-zA-Z0-9-_\/]+)/i);
    if (repoMatch) {
      return repoMatch[1];
    }

    // Try to extract package name
    const packageMatch = description.match(/package[:\s]+([a-zA-Z0-9-_]+)/i);
    if (packageMatch) {
      return packageMatch[1];
    }

    return 'Unknown';
  }

  /**
   * Extract recommended actions from description
   */
  private extractRecommendedActions(description: string): string[] {
    const actions: string[] = [];
    
    // Parse structured VM ticket format - look for Component + Recommended Version pairs
    const lines = description.split('\n');
    let currentComponent = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for component line
      const componentMatch = line.match(/Component:\s*([^\n\r]+)/i);
      if (componentMatch) {
        currentComponent = componentMatch[1].trim();
        continue;
      }
      
      // Look for recommended version line
      const recommendedVersionMatch = line.match(/Recommended Version:\s*([^\n\r]+)/i);
      if (recommendedVersionMatch) {
        const version = recommendedVersionMatch[1].trim();
        if (currentComponent) {
          actions.push(`Update ${currentComponent} to version ${version}`);
          currentComponent = ''; // Reset after pairing
        } else {
          actions.push(`Update to version ${version}`);
        }
        continue;
      }
    }
    
    // Fallback: Parse recommended version without component pairing
    if (actions.length === 0) {
      const recommendedVersionMatch = description.match(/Recommended Version:\s*([^\n\r]+)/i);
      if (recommendedVersionMatch) {
        const version = recommendedVersionMatch[1].trim();
        actions.push(`Update to version ${version}`);
      }
    }

    // Parse remediation command if available
    const remediationMatch = description.match(/Remediation Command:\s*([\s\S]*?)(?:\n[A-Z]|$)/i);
    if (remediationMatch) {
      const command = remediationMatch[1].trim();
      if (command && !command.toLowerCase().includes('n/a')) {
        actions.push(`Run: ${command}`);
      }
    }
    
    // Fallback to pattern matching for other formats
    const actionPatterns = [
      /update?\s+(?:to|version)\s+([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)/gi,
      /upgrade?\s+(?:to|version)\s+([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)/gi,
      /fix(?:ed)?\s+in\s+(?:version\s+)?([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)/gi,
      /patch(?:ed)?\s+in\s+(?:version\s+)?([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)/gi,
    ];

    for (const pattern of actionPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(description)) !== null) {
        if (match && match[1]) {
          const version = match[1];
          if (!actions.some(action => action.includes(version))) {
            actions.push(`Update to version ${version}`);
          }
        }
      }
    }

    // Add generic actions if specific ones not found
    if (actions.length === 0) {
      if (description.toLowerCase().includes('update') || description.toLowerCase().includes('upgrade')) {
        actions.push('Update to latest secure version');
      }
      if (description.toLowerCase().includes('remove') || description.toLowerCase().includes('replace')) {
        actions.push('Remove or replace vulnerable dependency');
      }
    }

    return [...new Set(actions)]; // Remove duplicates
  }

  /**
   * Search for tickets using JQL
   */
  async searchTickets(jql: string, maxResults: number = 50): Promise<JiraTicket[]> {
    try {
      logger.info(`Searching JIRA tickets with JQL: ${jql}`);

      const response = await this.client.get('/search', {
        params: {
          jql,
          maxResults,
          fields: 'summary,description,status,priority,assignee,reporter,created,updated,labels',
        },
      });

      const tickets: JiraTicket[] = [];
      
      for (const issue of response.data.issues) {
        const wizFindings = this.parseWizFindings(issue);
        
        const ticket: JiraTicket = {
          id: issue.id,
          key: issue.key,
          summary: issue.fields.summary,
          description: this.extractTextFromDescription(issue.fields.description),
          status: issue.fields.status.name,
          priority: issue.fields.priority?.name || 'Medium',
          assignee: issue.fields.assignee?.displayName,
          reporter: issue.fields.reporter?.displayName || 'Unknown',
          createdAt: new Date(issue.fields.created),
          updatedAt: new Date(issue.fields.updated),
          wizFindings,
        };

        tickets.push(ticket);
      }

      logger.info(`Found ${tickets.length} tickets`);
      return tickets;
    } catch (error: any) {
      logger.error('Error searching JIRA tickets:', error);
      throw new Error(`Failed to search JIRA tickets: ${error.message}`);
    }
  }

  /**
   * Get Wiz security tickets from the configured project
   */
  async getWizSecurityTickets(days: number = 30): Promise<JiraTicket[]> {
    const jql = `project = "${this.config.projectKey}" AND created >= -${days}d AND (labels in (security, vulnerability, wiz) OR summary ~ "security" OR summary ~ "vulnerability" OR summary ~ "CVE")`;
    
    return this.searchTickets(jql);
  }
} 
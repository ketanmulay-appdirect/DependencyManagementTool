# Security Dependency Management Tool

A comprehensive web-based tool that helps developers manage security vulnerabilities identified by Wiz Security across multiple repositories. The tool analyzes dependencies, suggests fixes, and automates PR creation.

![Security Dependency Tool](https://img.shields.io/badge/Security-Dependency%20Tool-blue)
![Next.js](https://img.shields.io/badge/Next.js-14.0-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Express](https://img.shields.io/badge/Express-4.18-green)

## 🚀 Features

### Core Functionality
- **Multi-Repository Analysis**: Analyze dependencies across multiple GitHub repositories
- **Wiz Integration**: Fetch and parse security findings from JIRA tickets
- **Dependency Tree Visualization**: Interactive dependency tree with vulnerability mapping
- **Smart Fix Suggestions**: AI-powered recommendations with confidence scoring
- **Automated PR Creation**: Generate pull requests with comprehensive fix descriptions

### Supported Package Managers
- **JavaScript**: npm, yarn
- **Python**: pip, poetry, pipenv
- **Java**: Maven, Gradle
- **Go**: Go modules
- **Ruby**: Bundler

### Security Features
- **Vulnerability Detection**: CVE matching with dependency versions
- **Risk Assessment**: CVSS scoring and severity classification
- **Breaking Change Analysis**: Identify potential compatibility issues
- **Migration Guidance**: Detailed upgrade instructions

## 🏗️ Architecture

```
security-dependency-tool/
├── src/
│   ├── frontend/          # Next.js React application
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Next.js pages
│   │   └── styles/        # Global CSS and Tailwind config
│   └── backend/           # Express.js API server
│       ├── services/      # Business logic services
│       ├── middleware/    # Express middleware
│       ├── controllers/   # API route handlers
│       └── utils/         # Utility functions
├── tests/                 # Test files
└── docs/                  # Documentation
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+ and npm
- Git
- GitHub Personal Access Token
- JIRA API Token (for Wiz integration)

### 1. Clone Repository
```bash
git clone <repository-url>
cd security-dependency-tool
```

### 2. Install Dependencies
```bash
# Install backend dependencies
cd src/backend && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Return to root directory
cd ../..
```

### 3. Environment Configuration
Create environment files for backend configuration:

```bash
# Backend configuration (create as needed)
cp src/backend/.env.example src/backend/.env
```

Configure the following environment variables:

```env
# Backend Configuration
PORT=3001
NODE_ENV=development

# GitHub Integration
GITHUB_TOKEN=your-github-personal-access-token

# JIRA Integration
JIRA_BASE_URL=https://your-organization.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_PROJECT_KEY=WIZ

# Security
JWT_SECRET=your-super-secret-jwt-key
ENCRYPTION_KEY=your-32-character-encryption-key

# Database (Optional - for persistence)
MONGODB_URI=mongodb://localhost:27017/security-dependency-tool
REDIS_URL=redis://localhost:6379
```

### 4. Start Development Servers
```bash
# Start backend server (Terminal 1)
cd src/backend && npm run dev

# Start frontend server (Terminal 2)
cd src/frontend && npm run dev

# Frontend will be available at: http://localhost:3000
# Backend API will be available at: http://localhost:3001
```

## 📋 Usage Guide

### 1. Repository Analysis

1. **Navigate** to `http://localhost:3000`
2. **Enter Repository Information**:
   - GitHub repository URL (e.g., `https://github.com/owner/repo`)
   - JIRA ticket keys (comma-separated, e.g., `WIZ-123, WIZ-456`)
3. **Provide Authentication**:
   - GitHub Personal Access Token (requires `repo` and `read:org` permissions)
   - JIRA email and API token
   - JIRA base URL
4. **Click "Start Analysis"**

### 2. Review Results

The tool provides:
- **Repository Overview**: Basic repository information and statistics
- **Vulnerability Table**: Detailed list of security issues with:
  - CVE identifiers and descriptions
  - Affected dependencies and versions
  - Severity levels and CVSS scores
  - Fix suggestions with confidence ratings
- **Dependency Tree**: Visual representation of all dependencies
- **Fix Recommendations**: Actionable suggestions for remediation

### 3. Create Pull Requests

1. **Select vulnerabilities** to fix from the vulnerability table
2. **Review fix suggestions** and potential breaking changes
3. **Customize PR details** (title, description, branch name)
4. **Generate pull request** with automated fixes

## 🔧 API Endpoints

### Repository Analysis
```http
POST /api/analysis/analyze-repository
Content-Type: application/json

{
  "repositoryUrl": "https://github.com/owner/repo",
  "jiraTickets": ["WIZ-123", "WIZ-456"],
  "githubToken": "ghp_...",
  "jiraToken": "...",
  "jiraEmail": "user@company.com",
  "jiraBaseUrl": "https://company.atlassian.net"
}
```

### Pull Request Creation
```http
POST /api/pull-requests/create
Content-Type: application/json

{
  "repositoryId": "repo-id",
  "selectedFixes": ["fix-id-1", "fix-id-2"],
  "prTitle": "Security: Update vulnerable dependencies",
  "prDescription": "Fixes security vulnerabilities...",
  "createSeparatePRs": false
}
```

## 🔒 Security Considerations

### Token Security
- **Tokens are never stored**: All API tokens are used only during analysis
- **Secure transmission**: HTTPS encryption for all communications
- **Memory cleanup**: Tokens are cleared from memory after use

### Access Control
- **Repository permissions**: Requires appropriate GitHub repository access
- **JIRA permissions**: Must have read access to specified JIRA tickets
- **Rate limiting**: API calls are rate-limited to prevent abuse

### Data Privacy
- **No data persistence**: Analysis results are not stored permanently
- **Audit logging**: All actions are logged for security monitoring
- **Token masking**: Sensitive information is masked in logs

## 🧪 Testing

```bash
# Run backend tests
cd src/backend && npm test

# Run frontend tests
cd src/frontend && npm test

# Run with coverage (from respective directories)
npm run test:coverage
```

## 📊 Development Scripts

```bash
# Backend Development (from src/backend/)
npm run dev             # Start backend development server
npm run build           # Build backend for production
npm run start           # Start production backend server
npm test                # Run backend tests

# Frontend Development (from src/frontend/)
npm run dev             # Start frontend development server
npm run build           # Build frontend for production
npm run start           # Start production frontend server
npm test                # Run frontend tests

# Code Quality (from respective directories)
npm run lint            # Run ESLint
npm run type-check      # TypeScript type checking
```

## 🌟 Advanced Features

### Package Manager Support
The tool automatically detects and parses:
- `package.json` (npm/yarn)
- `requirements.txt`, `pyproject.toml`, `Pipfile` (Python)
- `pom.xml`, `build.gradle` (Java)
- `go.mod` (Go)
- `Gemfile` (Ruby)

### Vulnerability Analysis
- **CVE Database Integration**: Real-time vulnerability lookup
- **Semantic Version Analysis**: Precise version range matching
- **Transitive Dependency Tracking**: Full dependency tree analysis
- **Risk Prioritization**: Severity-based vulnerability ranking

### Fix Intelligence
- **Breaking Change Detection**: Identifies potential compatibility issues
- **Update Strategy**: Minimal version bump recommendations
- **Migration Guidance**: Detailed upgrade instructions
- **Testing Recommendations**: Suggested test coverage areas

## 📈 Monitoring & Analytics

### Built-in Metrics
- Repository health scores
- Vulnerability trends over time
- Mean time to resolution
- Most common vulnerable packages

### Integration Options
- **Slack notifications**: Webhook integration for alerts
- **Email reports**: Scheduled vulnerability summaries
- **SIEM integration**: Security event logging
- **Dashboard exports**: CSV/JSON data export

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Add tests for new features
- Update documentation as needed
- Use conventional commit messages

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Common Issues

**Q: GitHub API rate limiting**
A: Use a GitHub App instead of personal access token for higher rate limits

**Q: JIRA authentication failures**
A: Ensure API token has correct permissions and email matches account

**Q: Large repository timeouts**
A: Increase timeout settings or use repository-specific analysis

### Getting Help
- 📖 Check the [Documentation](./docs/)
- 🐛 Report issues on [GitHub Issues](../../issues)
- 💬 Join discussions in [GitHub Discussions](../../discussions)

## 🔗 Related Resources

- [Wiz Security Platform](https://www.wiz.io/)
- [GitHub Security Advisories](https://github.com/advisories)
- [CVE Database](https://cve.mitre.org/)
- [OWASP Dependency Check](https://owasp.org/www-project-dependency-check/)

---

**Built with ❤️ for secure software development** 
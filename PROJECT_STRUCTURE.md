# Project Structure

This document outlines the clean, organized structure of the Security Dependency Management Tool.

## 📁 Root Directory

```
DependencyManagementTool/
├── .gitignore                          # Root gitignore file
├── README.md                           # Main project documentation
├── SETUP.md                           # Setup instructions
├── PROJECT_STRUCTURE.md               # This file
├── package.json                       # Root package configuration
├── package-lock.json                  # Root dependency lock file
├── EXPECTED_RESULTS.md                # Expected results documentation
├── MAVEN_DEPENDENCY_PARSING_FIX_SUMMARY.md
├── MAVEN_INTEGRATION_FIX_SUMMARY.md
├── docs/                              # Additional documentation
├── test/                              # Root-level tests
│   ├── README.md
│   ├── setup.ts
│   ├── integration/
│   └── unit/
└── src/                               # Source code
    ├── backend/                       # Express.js API server
    └── frontend/                      # Next.js React application
```

## 🔧 Backend Structure (`src/backend/`)

```
src/backend/
├── .gitignore                         # Backend-specific gitignore
├── package.json                       # Backend dependencies
├── tsconfig.json                      # TypeScript configuration
├── nodemon.json                       # Development server config
├── src/                               # Source code
│   ├── index.ts                       # Main server entry point
│   ├── config/                        # Configuration files
│   │   ├── database.ts                # Database connection
│   │   └── redis.ts                   # Redis connection
│   ├── middleware/                    # Express middleware
│   │   ├── auth.ts                    # Authentication middleware
│   │   ├── errorHandler.ts            # Error handling
│   │   └── requestLogger.ts           # Request logging
│   ├── routes/                        # API route handlers
│   │   ├── analysis.ts                # Analysis endpoints
│   │   ├── jira.ts                    # JIRA integration
│   │   ├── pullRequest.ts             # PR creation
│   │   └── repository.ts              # Repository operations
│   ├── services/                      # Business logic services
│   │   ├── dependencyAnalyzer/        # Dependency analysis
│   │   │   └── DependencyAnalyzer.ts
│   │   ├── fileParser/                # File parsing services
│   │   │   ├── index.ts
│   │   │   ├── FileParserService.ts
│   │   │   ├── GradleFileParser.ts
│   │   │   ├── MavenFileParser.ts
│   │   │   └── NpmFileParser.ts
│   │   ├── jira/                      # JIRA integration
│   │   │   └── JiraService.ts
│   │   ├── vulnerabilityFixers/       # Vulnerability fixing
│   │   │   ├── index.ts
│   │   │   ├── VulnerabilityFixerOrchestrator.ts
│   │   │   ├── GradleVulnerabilityFixer.ts
│   │   │   ├── MavenVulnerabilityFixer.ts
│   │   │   └── NpmVulnerabilityFixer.ts
│   │   └── vulnerabilityMatcher/      # Vulnerability matching
│   │       └── VulnerabilityMatcher.ts
│   ├── types/                         # TypeScript type definitions
│   │   └── index.ts
│   └── utils/                         # Utility functions
│       └── logger.ts                  # Logging utility
└── test/                              # Backend tests
    ├── setup.ts                       # Test setup
    ├── dependency-parsing.test.js     # Dependency parsing tests
    ├── maven-parsing.test.js          # Maven parsing tests
    ├── integration/                   # Integration tests
    │   └── VulnerabilityFixer.integration.test.ts
    └── unit/                          # Unit tests
        ├── GradleFileParser.test.ts
        └── MavenFileParser.test.ts
```

## 🎨 Frontend Structure (`src/frontend/`)

```
src/frontend/
├── .gitignore                         # Frontend-specific gitignore
├── package.json                       # Frontend dependencies
├── tsconfig.json                      # TypeScript configuration
├── next.config.js                     # Next.js configuration
├── tailwind.config.js                 # Tailwind CSS configuration
├── postcss.config.js                  # PostCSS configuration
├── next-env.d.ts                      # Next.js type definitions
├── components/                        # React components
│   ├── AnalysisProgress.tsx           # Analysis progress indicator
│   ├── ErrorBoundary.tsx              # Error boundary component
│   ├── LoadingSpinner.tsx             # Loading spinner
│   ├── RepositoryAnalysisForm.tsx     # Main analysis form
│   ├── StatsCard.tsx                  # Statistics card component
│   ├── DependencyTree/                # Dependency visualization
│   │   └── DependencyTree.tsx
│   ├── FalsePositivesTable/           # False positives display
│   │   └── FalsePositivesTable.tsx
│   ├── MajorUpgradeRequirements/      # Major upgrade requirements
│   │   └── MajorUpgradeRequirementsTable.tsx
│   ├── ui/                            # Reusable UI components
│   │   ├── index.ts
│   │   ├── Button.tsx
│   │   └── Input.tsx
│   ├── VulnerabilityDashboard/        # Main vulnerability dashboard
│   │   ├── index.ts
│   │   ├── VulnerabilityDashboard.tsx
│   │   ├── DashboardStats.tsx
│   │   ├── DependencyBadge.tsx
│   │   ├── FilterBar.tsx
│   │   ├── FixButton.tsx
│   │   ├── PackageManagerIcon.tsx
│   │   ├── SeverityBadge.tsx
│   │   ├── ViewToggle.tsx
│   │   ├── VulnerabilityCard.tsx
│   │   └── VulnerabilityTableRow.tsx
│   └── VulnerabilityTable/            # Vulnerability table components
│       ├── VulnerabilityTable.tsx
│       ├── FixSuggestionModal.tsx
│       ├── PackageManagerBadge.tsx
│       └── SeverityBadge.tsx
├── hooks/                             # Custom React hooks
│   ├── index.ts
│   ├── useApi.ts                      # API interaction hook
│   └── useUtils.ts                    # Utility hooks
├── pages/                             # Next.js pages
│   ├── _app.tsx                       # App wrapper
│   ├── _document.tsx                  # Document wrapper
│   └── index.tsx                      # Main page
├── public/                            # Static assets
│   └── manifest.json                  # Web app manifest
└── types/                             # TypeScript type definitions
    └── index.ts
```

## 🧪 Test Structure

### Backend Tests (`src/backend/test/`)
- **Unit Tests**: Individual component testing
- **Integration Tests**: Service integration testing
- **Parsing Tests**: File parser validation

### Root Tests (`test/`)
- **Setup**: Test environment configuration
- **Integration**: Cross-service testing
- **Documentation**: Test documentation

## 📦 Package Management

### Dependencies Structure
- **Root**: Shared development tools and scripts
- **Backend**: Express.js, TypeScript, testing frameworks
- **Frontend**: Next.js, React, Tailwind CSS, testing libraries

### Build Artifacts (Ignored)
- `node_modules/` - All dependency installations
- `dist/` - Compiled TypeScript output
- `.next/` - Next.js build output
- `*.tsbuildinfo` - TypeScript incremental build info
- `*.log` - Log files
- `temp/` - Temporary files and cached repositories

## 🔧 Configuration Files

### TypeScript Configuration
- `src/backend/tsconfig.json` - Backend TypeScript config
- `src/frontend/tsconfig.json` - Frontend TypeScript config

### Build Configuration
- `src/frontend/next.config.js` - Next.js configuration
- `src/frontend/tailwind.config.js` - Tailwind CSS configuration
- `src/backend/nodemon.json` - Development server configuration

### Git Configuration
- `.gitignore` - Root ignore patterns
- `src/backend/.gitignore` - Backend-specific ignores
- `src/frontend/.gitignore` - Frontend-specific ignores

## 🚀 Development Workflow

### Starting Development
1. Install dependencies in both backend and frontend
2. Start backend server (`src/backend/npm run dev`)
3. Start frontend server (`src/frontend/npm run dev`)

### Building for Production
1. Build backend (`src/backend/npm run build`)
2. Build frontend (`src/frontend/npm run build`)

### Running Tests
1. Backend tests (`src/backend/npm test`)
2. Frontend tests (`src/frontend/npm test`)

## 📝 Documentation Structure

- `README.md` - Main project documentation
- `SETUP.md` - Detailed setup instructions
- `PROJECT_STRUCTURE.md` - This structure overview
- `docs/` - Additional documentation
- Component-level documentation within source files

## 🔒 Security Considerations

### Excluded from Version Control
- Environment variables (`.env*`)
- API tokens and secrets
- Temporary repository clones
- Build artifacts and logs
- Node modules and dependencies

### Included in Version Control
- Source code and configuration
- Documentation and setup guides
- Test files and test configuration
- Package definitions (without lock files in some cases)

---

This structure ensures a clean, maintainable, and secure codebase ready for GitHub collaboration.

# 🚀 Quick Setup Guide

This guide will help you get the Security Dependency Management Tool running quickly.

## Prerequisites

- **Node.js 18+** and npm
- **Git** (for repository cloning)
- **GitHub Personal Access Token** ([Create here](https://github.com/settings/tokens))
- **JIRA API Token** ([Create here](https://id.atlassian.com/manage-profile/security/api-tokens))

## 🔧 Installation

### 1. Install Dependencies

```bash
# Install all dependencies for frontend and backend
npm run install:all
```

### 2. Environment Configuration

The application will work without database connections (in-memory mode), but you'll need API tokens:

#### Required Environment Variables

Create a `.env` file in `src/backend/` with:

```env
# Required for basic functionality
PORT=3001
NODE_ENV=development

# Optional - for persistence (app works without these)
MONGODB_URI=mongodb://localhost:27017/security-dependency-tool
REDIS_URL=redis://localhost:6379

# Optional - for authentication (app works without this)
JWT_SECRET=your-super-secret-jwt-key
```

## 🚀 Quick Start

### Start the Application

```bash
# Start both frontend (port 3000) and backend (port 3001)
npm run dev
```

### Open in Browser

Navigate to `http://localhost:3000`

## 📝 Using the Tool

### 1. Prepare Your Credentials

Before using the tool, gather:

- **GitHub Repository URL**: `https://github.com/owner/repository`
- **JIRA Ticket Keys**: Comma-separated (e.g., `WIZ-123, WIZ-456`)
- **GitHub Token**: Personal access token with `repo` permissions
- **JIRA Email**: Your Atlassian account email
- **JIRA Token**: API token from Atlassian
- **JIRA Base URL**: Your organization's JIRA URL (e.g., `https://company.atlassian.net`)

### 2. Run Analysis

1. **Fill out the form** with your repository and credential information
2. **Click "Start Analysis"** - the tool will:
   - Clone your repository
   - Scan for package files (package.json, requirements.txt, etc.)
   - Fetch JIRA tickets and Wiz findings
   - Analyze dependencies for vulnerabilities
   - Generate fix suggestions

3. **Review Results**:
   - View vulnerability table with severity levels
   - Examine dependency tree visualization
   - Check fix suggestions with confidence scores

### 3. Create Pull Requests

1. **Select vulnerabilities** to fix from the table
2. **Click "Create PR"** to generate pull requests with fixes

## 🔧 Development

### Project Structure

```
src/
├── frontend/          # Next.js + TypeScript + Tailwind
│   ├── components/    # React components
│   ├── pages/         # Next.js pages
│   └── styles/        # CSS and styling
└── backend/           # Express.js + TypeScript
    ├── services/      # GitHub, JIRA, Analysis services
    ├── routes/        # API endpoints
    ├── middleware/    # Express middleware
    └── types/         # TypeScript definitions
```

### Available Scripts

```bash
# Development
npm run dev              # Start both frontend and backend
npm run dev:frontend     # Start frontend only (port 3000)
npm run dev:backend      # Start backend only (port 3001)

# Building
npm run build           # Build frontend for production
npm run start           # Start production server

# Code Quality
npm run lint            # Run ESLint
npm run type-check      # TypeScript type checking
```

## 🛠️ Advanced Configuration

### Database Setup (Optional)

The application works without databases but you can add persistence:

#### MongoDB
```bash
# Install MongoDB locally or use MongoDB Atlas
npm install -g mongodb

# Start MongoDB (if local)
mongod --dbpath /your/data/directory
```

#### Redis
```bash
# Install Redis locally or use Redis Cloud
brew install redis  # macOS
sudo apt install redis-server  # Ubuntu

# Start Redis
redis-server
```

### GitHub App Setup (Optional)

For higher rate limits, consider creating a GitHub App:

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new GitHub App
3. Add the App ID and private key to your environment

### JIRA Project Configuration

1. **Find your JIRA Project Key** (usually visible in ticket URLs)
2. **Ensure your API token has access** to the project
3. **Verify ticket format** matches Wiz Security findings

## 🔍 Testing the Setup

### Test with a Sample Repository

Try analyzing a small public repository first:

1. **Repository URL**: `https://github.com/vulnerableapp/node-app`
2. **Mock JIRA Tickets**: `TEST-123, TEST-456` (the tool will handle non-existent tickets gracefully)
3. **Your real GitHub token**: Required for repository access
4. **Your real JIRA credentials**: Required for JIRA API calls

### Expected Behavior

✅ **Success indicators:**
- Repository information displays correctly
- Package files are detected and parsed
- Dependency tree shows packages
- JIRA integration attempts to fetch tickets (may warn about non-existent tickets)

⚠️ **Common issues:**
- **GitHub 401**: Check token permissions
- **JIRA 401**: Verify email and API token
- **Repository not found**: Ensure repository is public or token has access
- **No package files**: Repository may not have supported package managers

## 🚑 Troubleshooting

### Frontend Issues

```bash
# Clear Next.js cache
rm -rf src/frontend/.next

# Reinstall dependencies
rm -rf src/frontend/node_modules
cd src/frontend && npm install
```

### Backend Issues

```bash
# Check logs
npm run dev:backend

# Clear TypeScript cache
rm -rf src/backend/dist

# Reinstall dependencies
rm -rf src/backend/node_modules
cd src/backend && npm install
```

### API Issues

1. **Check browser console** for frontend errors
2. **Check terminal output** for backend errors
3. **Verify environment variables** are loaded correctly
4. **Test API endpoints** individually using curl or Postman

## 📖 Next Steps

1. **Explore the codebase** to understand the architecture
2. **Add real vulnerability databases** (NVD, GitHub Advisory Database)
3. **Implement actual PR creation** (currently mocked)
4. **Add user authentication** for multi-user scenarios
5. **Set up CI/CD integration** for automated scanning

## 🆘 Getting Help

- **Check the logs** in your terminal for detailed error messages
- **Review the README.md** for comprehensive documentation
- **Examine the code** - it's well-commented and structured
- **Test with simpler inputs** if you encounter issues

---

**You're ready to secure your dependencies! 🛡️** 
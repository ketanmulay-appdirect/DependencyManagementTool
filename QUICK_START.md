# Quick Start Guide

Get the Security Dependency Management Tool running in under 5 minutes!

## 🚀 One-Command Setup

```bash
# 1. Clone the repository
git clone https://github.com/ketanmulay-appdirect/DependencyManagementTool.git
cd DependencyManagementTool

# 2. Install all dependencies
npm run install:all

# 3. Start both frontend and backend
npm run dev
```

That's it! 🎉

## 🌐 Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

## 📋 What You'll See

When you run `npm run dev`, you'll see colored output like this:

```
[FRONTEND] ▲ Next.js 14.0.0
[FRONTEND] - Local:        http://localhost:3000
[BACKEND]  🚀 Security Dependency Management Tool API running on port 3001
[BACKEND]  📖 Environment: development
```

## ⚙️ Configuration (Optional)

For full functionality, configure your API tokens:

1. **GitHub Token**: Get from https://github.com/settings/tokens
2. **JIRA Token**: Get from your Atlassian account settings
3. **Enter tokens in the web interface** when analyzing repositories

## 🛑 Stopping the Services

Press `Ctrl+C` in the terminal to stop both services.

## 📚 Need More Help?

- 📖 Full documentation: [README.md](./README.md)
- 🏗️ Project structure: [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)
- ⚙️ Detailed setup: [SETUP.md](./SETUP.md)

## 🔧 Available Commands

```bash
npm run dev           # Start both services
npm run install:all   # Install all dependencies
npm test              # Run all tests
npm run build         # Build for production
npm run start         # Start production servers
```

---

**Happy coding! 🎯**

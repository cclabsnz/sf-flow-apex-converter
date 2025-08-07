# Contributing to SF Flow Apex Converter

Thank you for your interest in contributing to the SF Flow Apex Converter project! This document provides guidelines and instructions for contributing.

## 🤝 How to Contribute

### Reporting Issues
- Check existing issues before creating a new one
- Include flow XML samples when reporting parsing issues
- Provide clear reproduction steps
- Include error messages and logs

### Suggesting Enhancements
- Open an issue with the "enhancement" label
- Describe the use case and expected behavior
- Provide examples if possible

### Code Contributions

1. **Fork the Repository**
   ```bash
   git clone https://github.com/your-username/sf-flow-apex-converter.git
   cd sf-flow-apex-converter
   ```

2. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Your Changes**
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation as needed

4. **Test Your Changes**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

5. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

6. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## 📋 Development Guidelines

### Code Style
- Use TypeScript for all new code
- Follow existing naming conventions
- Add JSDoc comments for public methods
- Keep functions small and focused

### Testing
- Write unit tests for new features
- Ensure all tests pass before submitting PR
- Test with various flow patterns

### Documentation
- Update README for new features
- Add inline comments for complex logic
- Update type definitions as needed

## 🏗️ Project Structure

Key files to understand:
- `SimplifiedFlowAnalyzer.ts` - Core analysis logic
- `BulkifiedApexGenerator.ts` - Apex generation
- `flow-bulkifier-cli.ts` - CLI interface

## 📝 Commit Message Format

We follow conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `test:` Test additions/changes
- `refactor:` Code refactoring
- `chore:` Maintenance tasks

## 🙏 Thank You!

Your contributions make this project better for everyone!
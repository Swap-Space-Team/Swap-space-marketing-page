# Swap Space Marketing Site

Local development environment for the Swap Space marketing website.

## Getting Started

### Option 1: Using Node.js (Recommended)

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

This will:
- Start a local server on `http://localhost:3000`
- Automatically open your browser

Or use:
```bash
npm start
```
to start without auto-opening the browser.

### Option 2: Using Python

If you have Python 3 installed, you can use:

```bash
npm run serve
```

Or directly:
```bash
python3 -m http.server 3000
```

Then visit `http://localhost:3000` in your browser.

## Project Structure

```
├── Index.html          # Main HTML file
├── Style.css          # Stylesheet
├── assets/            # Images, fonts, and other assets
└── package.json       # Node.js dependencies and scripts
```

## Development

- The server will serve files from the root directory
- Changes to HTML/CSS will require a browser refresh
- The server runs on port 3000 by default

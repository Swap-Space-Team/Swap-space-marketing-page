# Swap Space Marketing Site

Local development environment for the Swap Space marketing website.

## Prerequisites

- Node.js (v14 or higher) - [Download here](https://nodejs.org/)
- npm (comes with Node.js)

OR

- Python 3 (for alternative server option)

## Getting Started

### Start the Development Server

### Option 1: Using Node.js with Live Server (Recommended)

This option provides auto-reload when you make changes to files.

1. Install dependencies (if not already done):
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

This will:
- Start a local server on `http://localhost:3000`
- Automatically open your browser to the site
- Watch for file changes and auto-reload the page

Or use:
```bash
npm start
```
to start without auto-opening the browser.

**Access your site at:** `http://localhost:3000`

### Troubleshooting

If the server doesn't start or you encounter issues:

1. **Check if port 3000 is in use:**
   ```bash
   lsof -ti:3000
   ```
   If something is running, stop it first.

2. **Try a different port** - Edit `package.json` and change `--port=3000` to `--port=8080`

3. **Check browser console** - Open Developer Tools (F12) and check for errors

4. **See TROUBLESHOOTING.md** for more help

### Option 2: Using Python HTTP Server

If you have Python 3 installed, you can use:

```bash
npm run serve
```

Or directly:
```bash
python3 -m http.server 3000
```

Then visit `http://localhost:3000/Index.html` in your browser.

**Note:** Python server doesn't auto-reload - you'll need to manually refresh the browser.

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

## Production build / Vercel

- Run `npm run build` to copy the static site into `dist/`
- Vercel is configured (see `vercel.json`) to run this build and deploy the `dist` folder
- The rewrite in `vercel.json` ensures the root path serves `Index.html`

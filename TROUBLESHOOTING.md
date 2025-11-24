# Troubleshooting Guide

## Server Not Starting?

### Check if port 3000 is already in use:
```bash
lsof -ti:3000
```

If something is running, kill it:
```bash
kill -9 $(lsof -ti:3000)
```

### Try a different port:
Edit `package.json` and change the port from 3000 to 8080:
```json
"dev": "live-server --port=8080 --open=/Index.html --watch=."
```

Then access at `http://localhost:8080`

## CORS Issues with API

If you see CORS errors in the browser console when fetching from the API, the backend needs to allow requests from your localhost. 

**Temporary workaround:** Use a browser extension like "CORS Unblock" for development, or ask your backend team to add `http://localhost:3000` to the allowed origins.

## Server Starts But Page is Blank

1. Check browser console for errors (F12 → Console tab)
2. Make sure you're accessing `http://localhost:3000/Index.html` (note the capital I)
3. Check if files are being served correctly

## Quick Test

Run this to test if the server works:
```bash
npm start
```

Then in another terminal:
```bash
curl http://localhost:3000/Index.html
```

You should see the HTML content.


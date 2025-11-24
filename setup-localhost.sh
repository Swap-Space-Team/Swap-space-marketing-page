#!/bin/bash

# Setup script for SwapSpace local development
# This adds swapspace.local to your /etc/hosts file

echo "Setting up swapspace.local domain..."

# Check if entry already exists
if grep -q "swapspace.local" /etc/hosts; then
    echo "✓ swapspace.local already configured in /etc/hosts"
else
    echo "Adding swapspace.local to /etc/hosts (requires sudo password)..."
    echo "127.0.0.1 swapspace.local" | sudo tee -a /etc/hosts
    echo "✓ swapspace.local added successfully!"
fi

echo ""
echo "Setup complete! You can now access the site at:"
echo "  http://swapspace.local:3000"
echo ""
echo "To start the server, run: npm run dev"


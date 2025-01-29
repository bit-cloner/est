#!/usr/bin/env bash
set -e  # Exit immediately on error

# Usage: ./build_and_release.sh <VERSION_TAG> <GITHUB_REPO_URL>
# Example: ./build_and_release.sh 0.7 https://github.com/user/repo.git

VERSION=$1
GITHUB_REPO=$2

if [ -z "$VERSION" ] || [ -z "$GITHUB_REPO" ]; then
  echo "❌ Usage: $0 <VERSION_TAG> <GITHUB_REPO_URL>"
  exit 1
fi

# Check if GitHub CLI (gh) is installed
if ! command -v gh &>/dev/null; then
  echo "❌ GitHub CLI (gh) is not installed."
  echo "Please install it using: https://cli.github.com/"
  exit 1
fi

# Check if GitHub authentication is set up
if ! gh auth status &>/dev/null; then
  echo "❌ GitHub authentication is missing!"
  echo "👉 Please run: gh auth login"
  exit 1
fi

# Get current directory name
DIR_NAME=$(basename "$PWD")
RELEASE_DIR="release"

# Remove the existing release directory if it exists
if [[ -d "$RELEASE_DIR" ]]; then
  echo "🗑️ Removing existing release directory..."
  rm -rf "$RELEASE_DIR"
fi

echo "🔨 Creating new release directory..."
mkdir -p "$RELEASE_DIR"

echo "🔨 Building binaries for version: v$VERSION in project: $DIR_NAME"

# Define OS and ARCH combinations
TARGETS=(
  "darwin-amd64"
  "darwin-arm64"
  "linux-386"
  "linux-amd64"
  "linux-arm64"
  "windows-386"
  "windows-amd64"
)

# Build, compress, and checksum binaries
for TARGET in "${TARGETS[@]}"; do
  OS=${TARGET%-*}
  ARCH=${TARGET#*-}
  
  OUTPUT_NAME="${DIR_NAME}-${VERSION}-${OS}-${ARCH}"
  
  if [[ "$OS" == "windows" ]]; then
    GOOS="$OS" GOARCH="$ARCH" go build -o "${RELEASE_DIR}/${OUTPUT_NAME}.exe" *.go
    zip -j "${RELEASE_DIR}/${OUTPUT_NAME}.zip" "${RELEASE_DIR}/${OUTPUT_NAME}.exe"
    rm "${RELEASE_DIR}/${OUTPUT_NAME}.exe"
  else
    GOOS="$OS" GOARCH="$ARCH" go build -o "${RELEASE_DIR}/${OUTPUT_NAME}" *.go
    tar -czf "${RELEASE_DIR}/${OUTPUT_NAME}.tar.gz" -C "$RELEASE_DIR" "$OUTPUT_NAME"
    rm "${RELEASE_DIR}/${OUTPUT_NAME}"
  fi

  # Generate MD5 checksum (only if the file exists & is non-empty)
  for file in "${RELEASE_DIR}/${OUTPUT_NAME}.tar.gz" "${RELEASE_DIR}/${OUTPUT_NAME}.zip"; do
    if [[ -f "$file" ]]; then
      md5sum "$file" > "${file}.md5"
      if [[ ! -s "${file}.md5" ]]; then
        echo "⚠️ Warning: Empty MD5 file detected for $file. Removing it..."
        rm "${file}.md5"
      fi
    fi
  done
done

echo "✅ All binaries built, compressed, and checksummed successfully."

# Debugging: Check if duplicate files exist
echo "📂 Files ready for upload:"
ls -lah "$RELEASE_DIR"

# Delete previous GitHub release if it exists
if gh release view "v$VERSION" &>/dev/null; then
  echo "⚠️ Previous release found! Deleting old release..."
  gh release delete "v$VERSION" -y
fi

# Create GitHub release
echo "🚀 Creating GitHub release for v$VERSION ..."
gh release create "v$VERSION" \
  "${RELEASE_DIR}"/*.{tar.gz,zip} \
  --title "v$VERSION" \
  --notes "Release notes for v$VERSION"

echo "✅ GitHub release v$VERSION created successfully."

# Upload binaries to the repository
echo "📤 Uploading binaries to GitHub repository..."
for file in "${RELEASE_DIR}"/*.{tar.gz,zip,md5}; do
  if [[ -f "$file" ]]; then
    echo "📤 Uploading file: $file"
    gh release upload "v$VERSION" "$file"
  else
    echo "⚠️ Skipping missing file: $file"
  fi
done

echo "✅ All binaries uploaded successfully."

# Final cleanup step: remove the entire release directory
echo "🧹 Cleaning up release directory..."
rm -rf "$RELEASE_DIR"

echo "🎉 Release process completed successfully!"

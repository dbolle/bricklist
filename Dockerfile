# ---- Stage 1: Build frontend ----
FROM node:20-alpine AS frontend-builder

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build


# ---- Stage 2: Final image ----
FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source into /app/backend
COPY backend/ ./backend/

# Copy built React app
COPY --from=frontend-builder /build/dist ./frontend/dist

# Create data directory for SQLite volume
RUN mkdir -p /data

EXPOSE 8000

# Run from the backend directory so relative imports resolve
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

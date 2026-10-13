# Planner sidecar image (G-P5 spike). glibc base: OR-Tools publishes manylinux wheels only (no musllinux),
# so it cannot be pip-installed into the backend's node:22-alpine image.
FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PLANNER_HOST=0.0.0.0 PLANNER_PORT=8090
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY adapter.py server.py ./
RUN useradd --system planner
USER planner
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=2s --start-period=10s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8090/healthz',timeout=2)"
CMD ["python", "-I", "server.py"]

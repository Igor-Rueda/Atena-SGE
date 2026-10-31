FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# o serviço não precisa de root
USER nobody

EXPOSE 6000

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT_REGRESSAO:-6000} --workers 2 app:app"]

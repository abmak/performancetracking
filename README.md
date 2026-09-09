# VAS Revenue Target Tracking System

A full-stack revenue tracking and performance management system for the Ethio Telecom VAS (Value Added Services) Section.

## Tech Stack
- **Frontend:** React + Vite + Tailwind CSS + Recharts
- **Backend:** Node.js + Express
- **Database:** MySQL
- **File Import:** SheetJS (xlsx) for Excel/CSV processing

## Features
- 📊 **Dashboard** — KPI cards, target vs actual charts, service achievement table, category breakdown pie chart, monthly trend
- 🏢 **VAS Services** — CRUD management with categories and status
- 🎯 **Revenue Targets** — Set monthly/quarterly/yearly targets per service with achievement tracking
- 💰 **Revenue Data** — Manual data entry with daily trend visualization
- 📥 **Excel Import** — Bulk import revenue data from Excel/CSV files with template download
- 📈 **Reports** — Performance reports with charts and CSV export
- 📋 **Audit Trail** — Full activity logging for all create/update/delete/import actions

## Setup

### Prerequisites
- Node.js 18+
- MySQL 8+

### 1. Database Setup
```bash
# Update backend/.env with your MySQL credentials
cd backend
cp .env.example .env   # edit DB_HOST, DB_USER, DB_PASSWORD
npm run db:setup
```

### 2. Backend
```bash
cd backend
npm install
npm run dev    # starts on port 5000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev    # starts on port 3000 (proxies /api to :5000)
```

Open http://localhost:3000

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | /api/services | List / Create services |
| GET/PUT/DELETE | /api/services/:id | Get / Update / Delete service |
| GET/POST | /api/targets | List / Create targets |
| GET | /api/targets/:id/achievement | Target with achievement data |
| GET/POST | /api/revenue | List / Create revenue entries |
| GET | /api/revenue/summary | Revenue summary by service |
| GET | /api/revenue/daily-trend | Daily revenue trend data |
| POST | /api/imports/revenue | Upload Excel file |
| GET | /api/imports/history | Import history |
| GET | /api/reports/performance | Full performance report |
| GET | /api/reports/trend | Monthly trend data |
| GET/POST | /api/dashboard/kpis | Dashboard KPIs |
| GET | /api/dashboard/service-achievements | Per-service achievement |
| GET | /api/audit | Audit trail log |

## Excel Import Format

| Column | Required | Description |
|--------|----------|-------------|
| service_code | ✅ | Service code (e.g., CRBT, MTV) |
| amount | ✅ | Revenue amount in ETB |
| date | ✅ | Revenue date (YYYY-MM-DD) |
| notes | ❌ | Optional notes |

## Sample Data
The setup script seeds 10 VAS services, monthly/quarterly targets, and sample revenue data for August 2025.

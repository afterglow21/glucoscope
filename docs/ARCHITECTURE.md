# 🩸 GlucoScope Architecture

> **Understand today. Improve tomorrow.**

## Vision

GlucoScope is an open-source AI-powered diabetes companion built on top of Nightscout.

The goal is not only to display glucose values, but to help people living with diabetes understand today's data, learn from it, and make better decisions tomorrow.

---

# Core Principles

## 1. Live First

Real-time glucose should always be available.

Opening the dashboard should immediately answer one question:

> "How am I doing right now?"

---

## 2. AI Second

Numbers alone are not enough.

GlucoScope converts glucose data into meaningful explanations using AI.

The AI should encourage, educate and support — never judge.

---

## 3. Creator Friendly

Every day's data can become valuable content.

GlucoScope can generate:

- note articles
- Instagram posts
- Threads posts
- X posts

with one click.

---

## 4. Community Driven

Knowledge should be shared.

Users may choose to share

- glucose graphs
- meals
- insulin
- AI summaries

to help other people living with diabetes.

Privacy is always user-controlled.

---

# Architecture

Nightscout

↓

API Layer

↓

Data Engine

├── Statistics

├── Timeline

├── Prediction

├── AI Engine

└── Export Engine

↓

Presentation Layer

├── Live Dashboard

├── Daily Report

├── Medical Report

└── Creator Studio

---

# Components

## API Layer

Responsible for reading data from Nightscout.

Future:

- Libre
- Dexcom
- Other CGM sources

---

## Statistics Engine

Calculates

- TIR
- TAR
- TBR
- CV
- GMI
- Average
- Daily Score

---

## AI Engine

Provides

- Daily summary
- Weekly summary
- Coaching
- Pattern analysis

Powered by OpenAI.

---

## Creator Studio

Creates

- note article
- Instagram image
- Threads
- X

---

## Medical Report

Creates printable reports.

Future:

- PDF export
- Clinic mode
- HbA1c estimation

---

# Public & Private Modes

## Public Live View

Shareable dashboard.

Ideal for:

- friends
- family
- community

---

## Private Dashboard

Additional information

- AI
- settings
- reports
- creator tools

---

# Design Goals

Simple.

Fast.

Beautiful.

Helpful.

---

# Technology Stack

Frontend

- HTML
- CSS
- JavaScript

Charts

- Chart.js

Backend (Future)

- Azure Functions

Database

- Nightscout
- MongoDB Atlas

AI

- OpenAI API

Hosting

- Azure Static Web Apps

Version Control

- GitHub

---

# Motto

Every glucose value tells a story.

GlucoScope helps you understand that story.

---

> Understand today.
>
> Improve tomorrow.
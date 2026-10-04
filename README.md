# PixelPlate – Smart QR Dine-In Ordering System

PixelPlate is a smart QR-based dine-in ordering system designed to make restaurant ordering faster, easier, and more organized.

Customers can scan a table QR code, browse the menu, add items to their cart, place an order, make a demo payment, and track their order. Staff and administrators can manage orders and view business analytics.

## Features

* QR-based table identification
* Digital restaurant menu
* Add to cart and checkout
* Order placement and tracking
* Demo payment integration
* Staff order management
* Admin dashboard
* Sales and order analytics
* Top-selling dish analysis
* Daily, weekly, and monthly sales insights
* Role-based authentication

## Technology Stack

**Frontend**

* React.js
* Axios
* CSS
* React Router

**Backend**

* Python
* FastAPI
* Uvicorn
* SQLite
* JWT Authentication
* bcrypt

**Other Tools**

* Git & GitHub
* VS Code
* Razorpay Test Integration

## Project Structure


PixelPlate/
├── backend/
│   ├── frontend/
│   ├── server.py
│   └── requirements.txt
├── .gitignore
├── package.json
└── package-lock.json

## How to Run

### Backend

Open a terminal inside the `backend` folder:
.\venv\Scripts\activate
uvicorn server:app --host 0.0.0.0 --port 8000

### Frontend

Open another terminal inside:backend/frontend
Then run:npm start
Frontend: http://localhost:3000
Backend: http://127.0.0.1:8000

## User Roles

### Customer

* Browse menu
* Add food items to cart
* Place orders
* Track orders

### Staff

* View incoming orders
* Update order status

### Admin

* Manage menu
* View orders
* View sales analytics
* View business insights

## Database

PixelPlate currently uses SQLite for local data storage.

## Project Objective

The main objective of PixelPlate is to provide a simple, contactless, and efficient dine-in ordering experience while helping restaurant staff manage orders and giving administrators useful business insights.

## Developed As

This project was developed as a major academic project for B.Tech Computer Science and Engineering.

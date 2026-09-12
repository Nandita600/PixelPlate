import razorpay
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import hashlib
import hmac
import os
import secrets
import uuid

from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import jwt

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field


ROOT_DIR = Path(__file__).parent

# ---------------------------------------------------------
# DATABASE
# ---------------------------------------------------------

mongo_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = mongo_client[os.environ["DB_NAME"]]

RAZORPAY_KEY_ID = os.environ["RAZORPAY_KEY_ID"]
RAZORPAY_KEY_SECRET = os.environ["RAZORPAY_KEY_SECRET"]

razorpay_client = razorpay.Client(
    auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
)

app = FastAPI(
    title="PixelPlate API",
    version="1.0.0"
)

api = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"


# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------

def now():
    return datetime.now(timezone.utc).isoformat()


def public(doc):
    if not doc:
        return None

    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)

    return doc


def hash_password(value):
    return bcrypt.hashpw(
        value.encode(),
        bcrypt.gensalt()
    ).decode()


def check_password(value, hashed):
    return bcrypt.checkpw(
        value.encode(),
        hashed.encode()
    )


def token_for(user):
    secret = os.environ["JWT_SECRET"]

    return jwt.encode(
        {
            "sub": user["id"],
            "role": user["role"],
            "email": user["email"],
            "exp": datetime.now(timezone.utc)
            + timedelta(hours=12)
        },
        secret,
        algorithm=JWT_ALGORITHM
    )


# ---------------------------------------------------------
# MODELS
# ---------------------------------------------------------

class Login(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class MenuItem(BaseModel):
    name: str
    description: str
    price: float = Field(gt=0)
    category: str
    image_url: str
    rating: float = Field(default=4.7, ge=0, le=5)
    featured: bool = False
    add_ons: List[dict] = []


class OrderLine(BaseModel):
    item_id: str
    name: str
    quantity: int = Field(gt=0)
    price: float
    add_ons: List[str] = []


class CreateOrder(BaseModel):
    customer_name: str = Field(min_length=2)
    phone: str = Field(min_length=8)
    table_number: str
    items: List[OrderLine]
    total: float = Field(gt=0)


class StatusUpdate(BaseModel):
    status: str


# ---------------------------------------------------------
# AUTHENTICATION
# ---------------------------------------------------------

async def current_user(request: Request):

    header = request.headers.get("Authorization", "")

    value = (
        header.removeprefix("Bearer ")
        if header.startswith("Bearer ")
        else request.cookies.get("access_token")
    )

    if not value:
        raise HTTPException(
            401,
            "Authentication required"
        )

    try:
        payload = jwt.decode(
            value,
            os.environ["JWT_SECRET"],
            algorithms=[JWT_ALGORITHM]
        )

    except jwt.PyJWTError:
        raise HTTPException(
            401,
            "Invalid or expired session"
        )

    user = await db.users.find_one(
        {"id": payload.get("sub")},
        {"_id": 0}
    )

    if not user:
        raise HTTPException(
            401,
            "User not found"
        )

    return user


def role_required(*roles):

    async def dependency(
        user=Depends(current_user)
    ):

        if user["role"] not in roles:
            raise HTTPException(
                403,
                "You do not have permission for this area"
            )

        return user

    return dependency


# ---------------------------------------------------------
# BASIC ROUTES
# ---------------------------------------------------------

@api.get("/")
async def root():

    return {
        "service": "PixelPlate",
        "status": "online"
    }


# ---------------------------------------------------------
# LOGIN
# ---------------------------------------------------------

@api.post("/auth/login")
async def login(
    body: Login,
    response: Response
):

    user = await db.users.find_one(
        {"email": body.email.lower()},
        {"_id": 0}
    )

    if not user or not check_password(
        body.password,
        user["password_hash"]
    ):

        raise HTTPException(
            401,
            "Email or password is incorrect"
        )

    token = token_for(user)

    response.set_cookie(
        "access_token",
        token,
        httponly=True,
        samesite="lax",
        max_age=43200
    )

    return {
        "token": token,
        "user": public(user)
    }


@api.get("/auth/me")
async def me(
    user=Depends(current_user)
):

    return public(user)


@api.post("/auth/logout")
async def logout(
    response: Response
):

    response.delete_cookie(
        "access_token"
    )

    return {
        "ok": True
    }


# ---------------------------------------------------------
# MENU
# ---------------------------------------------------------

@api.get("/menu")
async def menu(
    category: Optional[str] = None
):

    query = (
        {"category": category}
        if category and category != "All"
        else {}
    )

    return [
        public(x)
        async for x in db.menu.find(
            query,
            {"_id": 0}
        ).sort(
            "featured",
            -1
        )
    ]


# ---------------------------------------------------------
# TABLES
# ---------------------------------------------------------

@api.get("/tables")
async def tables():

    return [
        public(x)
        async for x in db.tables.find(
            {},
            {"_id": 0}
        ).sort(
            "number",
            1
        )
    ]


# ---------------------------------------------------------
# DEMO PAYMENT
# ---------------------------------------------------------

@api.post("/payments/demo")
async def demo_payment(
    body: CreateOrder
):

    order = {

        "id":
        "PP-" + secrets.token_hex(4).upper(),

        "customer_name":
        body.customer_name,

        "phone":
        body.phone,

        "table_number":
        body.table_number,

        "items": [
            item.model_dump()
            for item in body.items
        ],

        "total":
        body.total,

        "status":
        "received",

        "payment_status":
        "paid",

        "payment_id":
        "DEMO-" + secrets.token_hex(4).upper(),

        "created_at":
        now()
    }

    await db.orders.insert_one(order)

    return public(order)


# ---------------------------------------------------------
# RAZORPAY CREATE ORDER
# ---------------------------------------------------------

@api.post("/payments/create-order")
async def payment_order(
    body: CreateOrder
):

    key = os.environ.get(
        "RAZORPAY_KEY_ID"
    )

    secret = os.environ.get(
        "RAZORPAY_KEY_SECRET"
    )

    if not key or not secret:

        return {
            "available": False,
            "message":
            "Razorpay test credentials are not configured yet."
        }

    import requests

    res = requests.post(
        "https://api.razorpay.com/v1/orders",

        auth=(key, secret),

        json={
            "amount":
            round(body.total * 100),

            "currency":
            "INR",

            "receipt":
            "pp_" + secrets.token_hex(8)
        },

        timeout=15
    )

    if res.status_code >= 400:

        raise HTTPException(
            502,
            "Razorpay could not create a payment order"
        )

    data = res.json()

    await db.payments.insert_one(
        {
            "id":
            data["id"],

            "status":
            "created",

            "payload":
            body.model_dump(),

            "created_at":
            now()
        }
    )

    return {
        "available":
        True,

        "key_id":
        key,

        "order":
        data
    }


# ---------------------------------------------------------
# RAZORPAY VERIFY
# ---------------------------------------------------------

@api.post("/payments/verify")
async def verify_payment(
    payload: dict
):

    key = os.environ.get(
        "RAZORPAY_KEY_ID"
    )

    secret = os.environ.get(
        "RAZORPAY_KEY_SECRET"
    )

    if not key or not secret:

        raise HTTPException(
            503,
            "Razorpay test credentials are not configured"
        )

    message = (
        f'{payload.get("razorpay_order_id")}'
        f'|{payload.get("razorpay_payment_id")}'
    ).encode()

    signature = hmac.new(
        secret.encode(),
        message,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(
        signature,
        payload.get(
            "razorpay_signature",
            ""
        )
    ):

        raise HTTPException(
            400,
            "Payment verification failed"
        )

    payment = await db.payments.find_one(
        {
            "id":
            payload["razorpay_order_id"]
        },

        {
            "_id": 0
        }
    )

    if not payment:

        raise HTTPException(
            404,
            "Payment order not found"
        )

    order_data = payment["payload"]

    order = {

        "id":
        "PP-" + secrets.token_hex(4).upper(),

        "customer_name":
        order_data["customer_name"],

        "phone":
        order_data["phone"],

        "table_number":
        order_data["table_number"],

        "items":
        order_data["items"],

        "total":
        order_data["total"],

        "status":
        "received",

        "payment_status":
        "paid",

        "payment_id":
        payload["razorpay_payment_id"],

        "created_at":
        now()
    }

    await db.orders.insert_one(order)

    await db.payments.update_one(
        {
            "id":
            payment["id"]
        },

        {
            "$set":
            {
                "status":
                "paid",

                "payment_id":
                payload["razorpay_payment_id"]
            }
        }
    )

    return public(order)


# ---------------------------------------------------------
# GET SINGLE ORDER
# ---------------------------------------------------------

@api.get("/orders/{order_id}")
async def get_order(
    order_id: str
):

    order = await db.orders.find_one(
        {
            "id":
            order_id
        },

        {
            "_id": 0
        }
    )

    if not order:

        raise HTTPException(
            404,
            "Order reference not found"
        )

    return order


# ---------------------------------------------------------
# STAFF / ADMIN ORDERS
# ---------------------------------------------------------

@api.get("/orders")
async def orders(
    user=Depends(
        role_required(
            "admin",
            "staff"
        )
    )
):

    return [
        public(x)
        async for x in db.orders.find(
            {},
            {"_id": 0}
        ).sort(
            "created_at",
            -1
        )
    ]


# ---------------------------------------------------------
# UPDATE ORDER STATUS
# ---------------------------------------------------------

@api.patch("/orders/{order_id}/status")
async def update_status(
    order_id: str,
    body: StatusUpdate,
    user=Depends(
        role_required(
            "admin",
            "staff"
        )
    )
):

    allowed = [
        "received",
        "accepted",
        "preparing",
        "ready",
        "served"
    ]

    if body.status not in allowed:

        raise HTTPException(
            400,
            "Invalid order status"
        )

    result = await db.orders.update_one(
        {
            "id":
            order_id
        },

        {
            "$set":
            {
                "status":
                body.status,

                "updated_at":
                now()
            }
        }
    )

    if not result.matched_count:

        raise HTTPException(
            404,
            "Order not found"
        )

    return await db.orders.find_one(
        {
            "id":
            order_id
        },

        {
            "_id": 0
        }
    )


# ---------------------------------------------------------
# ADMIN ANALYTICS
# ---------------------------------------------------------

@api.get("/admin/analytics")
async def analytics(
    user=Depends(
        role_required("admin")
    )
):

    orders = [
        x async for x in db.orders.find(
            {
                "payment_status":
                "paid"
            },

            {
                "_id": 0
            }
        )
    ]

    india_tz = timezone(
        timedelta(
            hours=5,
            minutes=30
        )
    )

    now_utc = datetime.now(
        timezone.utc
    )

    now_india = now_utc.astimezone(
        india_tz
    )

    today = now_india.date()

    today_orders = []

    total_revenue = 0

    dish_counter = {}

    customers = set()

    for order in orders:

        total = float(
            order.get(
                "total",
                0
            ) or 0
        )

        total_revenue += total

        phone = order.get(
            "phone"
        )

        if phone:
            customers.add(phone)

        created_at = order.get(
            "created_at"
        )

        if isinstance(
            created_at,
            str
        ):

            try:

                created_at = datetime.fromisoformat(
                    created_at.replace(
                        "Z",
                        "+00:00"
                    )
                )

            except Exception:

                created_at = None

        if (
            created_at
            and created_at.tzinfo is None
        ):

            created_at = created_at.replace(
                tzinfo=timezone.utc
            )

        if created_at:

            order_date = (
                created_at
                .astimezone(india_tz)
                .date()
            )

            if order_date == today:

                today_orders.append(
                    order
                )

        for item in order.get(
            "items",
            []
        ):

            name = item.get(
                "name",
                "Unknown"
            )

            quantity = int(
                item.get(
                    "quantity",
                    1
                ) or 1
            )

            dish_counter[name] = (
                dish_counter.get(
                    name,
                    0
                )
                + quantity
            )

    today_revenue = sum(
        float(
            x.get(
                "total",
                0
            ) or 0
        )
        for x in today_orders
    )

    pending_statuses = [
        "received",
        "accepted",
        "preparing",
        "ready"
    ]

    completed_statuses = [
        "served"
    ]

    pending_orders = sum(
        1
        for x in orders
        if x.get("status")
        in pending_statuses
    )

    completed_orders = sum(
        1
        for x in orders
        if x.get("status")
        in completed_statuses
    )

    sorted_dishes = sorted(
        dish_counter.items(),
        key=lambda x: x[1],
        reverse=True
    )

    most_ordered_dish = (
        sorted_dishes[0][0]
        if sorted_dishes
        else "No orders yet"
    )

    most_ordered_quantity = (
        sorted_dishes[0][1]
        if sorted_dishes
        else 0
    )

    # ---------------------------------------------------------
    # DAILY SALES - LAST 7 DAYS
    # ---------------------------------------------------------

    daily_sales = []

    for i in range(
        6,
        -1,
        -1
    ):

        target_date = (
            today
            - timedelta(days=i)
        )

        day_orders = []

        for order in orders:

            created_at = order.get(
                "created_at"
            )

            if isinstance(
                created_at,
                str
            ):

                try:

                    created_at = datetime.fromisoformat(
                        created_at.replace(
                            "Z",
                            "+00:00"
                        )
                    )

                except Exception:

                    created_at = None

            if (
                created_at
                and created_at.tzinfo is None
            ):

                created_at = created_at.replace(
                    tzinfo=timezone.utc
                )

            if created_at:

                order_date = (
                    created_at
                    .astimezone(india_tz)
                    .date()
                )

                if order_date == target_date:

                    day_orders.append(
                        order
                    )

        revenue = sum(
            float(
                x.get(
                    "total",
                    0
                ) or 0
            )
            for x in day_orders
        )

        daily_sales.append(
            {
                "label":
                target_date.strftime(
                    "%d %b"
                ),

                "orders":
                len(day_orders),

                "revenue":
                revenue
            }
        )

    # ---------------------------------------------------------
    # WEEKLY SALES - LAST 6 WEEKS
    # ---------------------------------------------------------

    weekly_sales = []

    for i in range(
        5,
        -1,
        -1
    ):

        week_end = (
            today
            - timedelta(
                days=i * 7
            )
        )

        week_start = (
            week_end
            - timedelta(days=6)
        )

        week_orders = []

        for order in orders:

            created_at = order.get(
                "created_at"
            )

            if isinstance(
                created_at,
                str
            ):

                try:

                    created_at = datetime.fromisoformat(
                        created_at.replace(
                            "Z",
                            "+00:00"
                        )
                    )

                except Exception:

                    created_at = None

            if (
                created_at
                and created_at.tzinfo is None
            ):

                created_at = created_at.replace(
                    tzinfo=timezone.utc
                )

            if created_at:

                order_date = (
                    created_at
                    .astimezone(india_tz)
                    .date()
                )

                if (
                    week_start
                    <= order_date
                    <= week_end
                ):

                    week_orders.append(
                        order
                    )

        revenue = sum(
            float(
                x.get(
                    "total",
                    0
                ) or 0
            )
            for x in week_orders
        )

        weekly_sales.append(
            {
                "label":
                week_start.strftime(
                    "%d %b"
                ),

                "orders":
                len(week_orders),

                "revenue":
                revenue
            }
        )

    # ---------------------------------------------------------
    # MONTHLY SALES - LAST 6 MONTHS
    # ---------------------------------------------------------

    monthly_sales = []

    current_year = today.year

    current_month = today.month

    for i in range(
        5,
        -1,
        -1
    ):

        month_index = (
            current_month - i
        )

        year = current_year

        while month_index <= 0:

            month_index += 12

            year -= 1

        month_orders = []

        for order in orders:

            created_at = order.get(
                "created_at"
            )

            if isinstance(
                created_at,
                str
            ):

                try:

                    created_at = datetime.fromisoformat(
                        created_at.replace(
                            "Z",
                            "+00:00"
                        )
                    )

                except Exception:

                    created_at = None

            if (
                created_at
                and created_at.tzinfo is None
            ):

                created_at = created_at.replace(
                    tzinfo=timezone.utc
                )

            if created_at:

                local_date = (
                    created_at
                    .astimezone(india_tz)
                    .date()
                )

                if (
                    local_date.year == year
                    and local_date.month == month_index
                ):

                    month_orders.append(
                        order
                    )

        revenue = sum(
            float(
                x.get(
                    "total",
                    0
                ) or 0
            )
            for x in month_orders
        )

        label = datetime(
            year,
            month_index,
            1
        ).strftime(
            "%b %Y"
        )

        monthly_sales.append(
            {
                "label":
                label,

                "orders":
                len(month_orders),

                "revenue":
                revenue
            }
        )

    # ---------------------------------------------------------
    # PEAK ORDERING HOUR
    # ---------------------------------------------------------

    hour_counter = {}

    for order in orders:

        created_at = order.get(
            "created_at"
        )

        if isinstance(
            created_at,
            str
        ):

            try:

                created_at = datetime.fromisoformat(
                    created_at.replace(
                        "Z",
                        "+00:00"
                    )
                )

            except Exception:

                created_at = None

        if (
            created_at
            and created_at.tzinfo is None
        ):

            created_at = created_at.replace(
                tzinfo=timezone.utc
            )

        if created_at:

            hour = (
                created_at
                .astimezone(india_tz)
                .hour
            )

            hour_counter[hour] = (
                hour_counter.get(
                    hour,
                    0
                )
                + 1
            )

    if hour_counter:

        peak_hour = max(
            hour_counter,
            key=hour_counter.get
        )

        peak_hour_label = (
            f"{peak_hour:02d}:00 - "
            f"{(peak_hour + 1) % 24:02d}:00"
        )

    else:

        peak_hour_label = "No data"

    # ---------------------------------------------------------
    # BUSINESS INSIGHT
    # ---------------------------------------------------------

    if today_orders:

        insight = (
            f"{len(today_orders)} paid order"
            f"{'s' if len(today_orders) != 1 else ''} "
            f"generated ₹{today_revenue:,.0f} today."
        )

    else:

        insight = (
            "No paid orders have been recorded today."
        )

    return {

        "total_revenue":
        total_revenue,

        "total_orders":
        len(orders),

        "today_orders":
        len(today_orders),

        "today_revenue":
        today_revenue,

        "pending_orders":
        pending_orders,

        "completed_orders":
        completed_orders,

        "total_customers":
        len(customers),

        "most_ordered_dish":
        most_ordered_dish,

        "most_ordered_quantity":
        most_ordered_quantity,

        "peak_hour":
        peak_hour_label,

        "top_items":
        [
            {
                "name":
                name,

                "quantity":
                quantity
            }

            for name, quantity
            in sorted_dishes[:5]
        ],

        "sales":
        {
            "daily":
            daily_sales,

            "weekly":
            weekly_sales,

            "monthly":
            monthly_sales
        },

        "insight":
        insight
    }


# ---------------------------------------------------------
# ADMIN MENU
# ---------------------------------------------------------

@api.post("/admin/menu")
async def add_menu(
    item: MenuItem,
    user=Depends(
        role_required("admin")
    )
):

    doc = item.model_dump()

    doc["id"] = (
        "item_"
        + uuid.uuid4().hex[:8]
    )

    await db.menu.insert_one(
        doc
    )

    return doc


@api.delete("/admin/menu/{item_id}")
async def delete_menu(
    item_id: str,
    user=Depends(
        role_required("admin")
    )
):

    await db.menu.delete_one(
        {
            "id":
            item_id
        }
    )

    return {
        "ok":
        True
    }


# ---------------------------------------------------------
# DATABASE SEED
# ---------------------------------------------------------

async def seed():

    if not os.environ.get(
        "JWT_SECRET"
    ):

        raise RuntimeError(
            "JWT_SECRET is required"
        )

    await db.users.create_index(
        "email",
        unique=True
    )

    users = [

        (
            os.environ["ADMIN_EMAIL"],
            os.environ["ADMIN_PASSWORD"],
            "admin",
            "Aarav Mehta"
        ),

        (
            os.environ["STAFF_EMAIL"],
            os.environ["STAFF_PASSWORD"],
            "staff",
            "Kitchen Team"
        )
    ]

    for email, password, role, name in users:

        if not await db.users.find_one(
            {
                "email":
                email
            }
        ):

            await db.users.insert_one(
                {
                    "id":
                    "usr_"
                    + uuid.uuid4().hex[:8],

                    "email":
                    email,

                    "password_hash":
                    hash_password(
                        password
                    ),

                    "role":
                    role,

                    "name":
                    name
                }
            )

    # =====================================================
    # PIXELPLATE - 20 COMPLETELY VEGETARIAN ITEMS
    # =====================================================

    items = [

        # -------------------------------------------------
        # INDIAN - 5 ITEMS
        # -------------------------------------------------

        {
            "id":
            "item_1",

            "category":
            "Indian",

            "name":
            "Paneer Butter Masala",

            "description":
            "Soft paneer cubes cooked in a rich, creamy tomato and butter gravy.",

            "rating":
            4.8,

            "price":
            280,

            "image_url":
            "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Extra Gravy",

                    "price":
                    50
                },

                {
                    "name":
                    "Butter Naan",

                    "price":
                    60
                }
            ]
        },

        {
            "id":
            "item_2",

            "category":
            "Indian",

            "name":
            "Paneer Tikka",

            "description":
            "Char-grilled paneer cubes marinated with yogurt and Indian spices.",

            "rating":
            4.7,

            "price":
            260,

            "image_url":
            "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Mint Chutney",

                    "price":
                    30
                },

                {
                    "name":
                    "Extra Paneer",

                    "price":
                    80
                }
            ]
        },

        {
            "id":
            "item_3",

            "category":
            "Indian",

            "name":
            "Veg Dum Biryani",

            "description":
            "Fragrant basmati rice cooked with seasonal vegetables, herbs and aromatic spices.",

            "rating":
            4.8,

            "price":
            260,

            "image_url":
              "https://images.pexels.com/photos/35041655/pexels-photo-35041655.jpeg?auto=compress&cs=tinysrgb&w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Raita",

                    "price":
                    40
                },

                {
                    "name":
                    "Extra Vegetables",

                    "price":
                    60
                }
            ]
        },

        {
            "id":
            "item_4",

            "category":
            "Indian",

            "name":
            "Masala Dosa",

            "description":
            "Crispy South Indian dosa served with potato masala, sambar and chutney.",

            "rating":
            4.6,

            "price":
            180,

            "image_url":
            "https://images.pexels.com/photos/12392915/pexels-photo-12392915.jpeg?auto=compress&cs=tinysrgb&w=800",
            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Extra Sambar",

                    "price":
                    30
                },

                {
                    "name":
                    "Cheese",

                    "price":
                    50
                }
            ]
        },

        {
            "id":
            "item_5",

            "category":
            "Indian",

            "name":
            "Dal Makhani",

            "description":
            "Slow-cooked black lentils finished with butter and cream.",

            "rating":
            4.7,

            "price":
            220,

            "image_url":
            "https://images.pexels.com/photos/37182514/pexels-photo-37182514.jpeg?auto=compress&cs=tinysrgb&w=800",
            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Butter Naan",

                    "price":
                    60
                },

                {
                    "name":
                    "Jeera Rice",

                    "price":
                    100
                }
            ]
        },


        # -------------------------------------------------
        # ITALIAN - 5 ITEMS
        # -------------------------------------------------

        {
            "id":
            "item_6",

            "category":
            "Italian",

            "name":
            "Margherita Pizza",

            "description":
            "Classic Italian pizza topped with tomato, mozzarella and fresh basil.",

            "rating":
            4.8,

            "price":
            280,

            "image_url":
            "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Extra Cheese",

                    "price":
                    70
                },

                {
                    "name":
                    "Olives",

                    "price":
                    40
                }
            ]
        },

        {
            "id":
            "item_7",

            "category":
            "Italian",

            "name":
            "Penne Arrabbiata",

            "description":
            "Penne pasta tossed in a spicy tomato and garlic sauce.",

            "rating":
            4.6,

            "price":
            240,

            "image_url":
            "https://images.pexels.com/photos/36841078/pexels-photo-36841078.jpeg?auto=compress&cs=tinysrgb&w=800",

            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Extra Cheese",

                    "price":
                    60
                },

                {
                    "name":
                    "Mushrooms",

                    "price":
                    50
                }
            ]
        },

        {
            "id":
            "item_8",

            "category":
            "Italian",

            "name":
            "Creamy Alfredo Pasta",

            "description":
            "Rich and creamy fettuccine pasta with parmesan, mushrooms and herbs.",

            "rating":
            4.7,

            "price":
            290,

            "image_url":
            "https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Extra Parmesan",

                    "price":
                    60
                },

                {
                    "name":
                    "Sautéed Mushrooms",

                    "price":
                    70
                }
            ]
        },

        {
            "id":
            "item_9",

            "category":
            "Italian",

            "name":
            "Classic Lasagna",

            "description":
            "Layers of pasta, rich tomato sauce, cheese and Italian herbs.",

            "rating":
            4.8,

            "price":
            320,

            "image_url":
            "https://images.unsplash.com/photo-1574894709920-11b28e7367e3?w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Extra Cheese",

                    "price":
                    70
                },

                {
                    "name":
                    "Garlic Bread",

                    "price":
                    90
                }
            ]
        },

        {
            "id":
            "item_10",

            "category":
            "Italian",

            "name":
            "Bruschetta",

            "description":
            "Toasted artisan bread topped with tomatoes, basil and olive oil.",

            "rating":
            4.5,

            "price":
            190,

            "image_url":
            "https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=800",

            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Mozzarella",

                    "price":
                    60
                },

                {
                    "name":
                    "Olives",

                    "price":
                    40
                }
            ]
        },


        # -------------------------------------------------
        # VEGETARIAN - 4 ITEMS
        # -------------------------------------------------

        {
            "id":
            "item_11",

            "category":
            "Vegetarian",

            "name":
            "Crispy Veggie Burger",

            "description":
            "Crispy vegetable patty with lettuce, tomato and house sauce.",

            "rating":
            4.6,

            "price":
            220,

            "image_url":
            "https://images.unsplash.com/photo-1520072959219-c595dc870360?w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Extra Cheese",

                    "price":
                    50
                },

                {
                    "name":
                    "French Fries",

                    "price":
                    80
                }
            ]
        },

        {
            "id":
            "item_12",

            "category":
            "Vegetarian",

            "name":
            "Mediterranean Falafel Bowl",

            "description":
            "Crispy falafel served with fresh vegetables, hummus and seasoned rice.",

            "rating":
            4.7,

            "price":
            260,

            "image_url":
            "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800",

            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Extra Hummus",

                    "price":
                    50
                },

                {
                    "name":
                    "Avocado",

                    "price":
                    80
                }
            ]
        },

        {
            "id":
            "item_13",

            "category":
            "Vegetarian",

            "name":
            "Grilled Veggie Panini",

            "description":
            "Grilled artisan bread filled with fresh vegetables, cheese and pesto.",

            "rating":
            4.5,

            "price":
            230,

            "image_url":
            "https://images.pexels.com/photos/8471738/pexels-photo-8471738.jpeg?auto=compress&cs=tinysrgb&w=800",
            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Extra Cheese",

                    "price":
                    50
                },

                {
                    "name":
                    "Pesto",

                    "price":
                    40
                }
            ]
        },

        {
            "id":
            "item_14",

            "category":
            "Vegetarian",

            "name":
            "Avocado Toast",

            "description":
            "Toasted sourdough topped with creamy avocado, herbs and cherry tomatoes.",

            "rating":
            4.6,

            "price":
            210,

            "image_url":
            "https://images.unsplash.com/photo-1541519227354-08fa5d50c44d?w=800",

            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Feta Cheese",

                    "price":
                    50
                },

                {
                    "name":
                    "Extra Avocado",

                    "price":
                    70
                }
            ]
        },


        # -------------------------------------------------
        # DESSERTS - 3 ITEMS
        # -------------------------------------------------

        {
            "id":
            "item_15",

            "category":
            "Desserts",

            "name":
            "Pistachio Tiramisu",

            "description":
            "Classic Italian tiramisu with a creamy pistachio twist.",

            "rating":
            4.9,

            "price":
            220,

            "image_url":
            "https://images.pexels.com/photos/5426047/pexels-photo-5426047.jpeg?auto=compress&cs=tinysrgb&w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Extra Pistachio",

                    "price":
                    40
                },

                {
                    "name":
                    "Chocolate Sauce",

                    "price":
                    30
                }
            ]
        },

        {
            "id":
            "item_16",

            "category":
            "Desserts",

            "name":
            "Chocolate Lava Cake",

            "description":
            "Warm chocolate cake with a rich molten chocolate center.",

            "rating":
            4.8,

            "price":
            240,

            "image_url":
            "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=800",

            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Vanilla Ice Cream",

                    "price":
                    70
                },

                {
                    "name":
                    "Chocolate Sauce",

                    "price":
                    30
                }
            ]
        },

        {
            "id":
            "item_17",

            "category":
            "Desserts",

            "name":
            "Gulab Jamun Cheesecake",

            "description":
            "Fusion cheesecake combining creamy cheesecake with Indian gulab jamun.",

            "rating":
            4.7,

            "price":
            260,

            "image_url":
            "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800",

            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Extra Gulab Jamun",

                    "price":
                    50
                },

                {
                    "name":
                    "Rabri",

                    "price":
                    50
                }
            ]
        },


        # -------------------------------------------------
        # BEVERAGES - 3 ITEMS
        # -------------------------------------------------

        {
            "id":
            "item_18",

            "category":
            "Beverages",

            "name":
            "Mango Lassi",

            "description":
            "Refreshing creamy yogurt drink blended with ripe mangoes.",

            "rating":
            4.8,

            "price":
            120,

            "image_url":
            "https://images.pexels.com/photos/14509267/pexels-photo-14509267.jpeg?auto=compress&cs=tinysrgb&w=800",
            "featured":
            True,

            "add_ons":
            [
                {
                    "name":
                    "Extra Mango",

                    "price":
                    30
                },

                {
                    "name":
                    "Dry Fruits",

                    "price":
                    40
                }
            ]
        },

        {
            "id":
            "item_19",

            "category":
            "Beverages",

            "name":
            "Masala Chai",

            "description":
            "Traditional Indian tea brewed with milk and aromatic spices.",

            "rating":
            4.6,

            "price":
            90,

            "image_url":
            "https://images.pexels.com/photos/29650995/pexels-photo-29650995.jpeg?auto=compress&cs=tinysrgb&w=800",
            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Extra Ginger",

                    "price":
                    20
                },

                {
                    "name":
                    "Honey",

                    "price":
                    30
                }
            ]
        },

        {
            "id":
            "item_20",

            "category":
            "Beverages",

            "name":
            "Fresh Lime Soda",

            "description":
            "Chilled sparkling lime drink with a refreshing citrus flavour.",

            "rating":
            4.5,

            "price":
            100,

            "image_url":
            "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=800",

            "featured":
            False,

            "add_ons":
            [
                {
                    "name":
                    "Mint",

                    "price":
                    20
                },

                {
                    "name":
                    "Extra Lime",

                    "price":
                    20
                }
            ]
        }
    ]

    # -----------------------------------------------------
    # UPDATE / INSERT MENU ITEMS
    # -----------------------------------------------------

    for item in items:

        await db.menu.update_one(
            {
                "id":
                item["id"]
            },

            {
                "$set":
                item
            },

            upsert=True
        )

    # -----------------------------------------------------
    # REMOVE OLD NON-VEG MENU ITEMS IF THEY EXIST
    # -----------------------------------------------------

    await db.menu.delete_many(
        {
            "$or":
            [
                {
                    "name":
                    {
                        "$regex":
                        "Butter Chicken",
                        "$options":
                        "i"
                    }
                },

                {
                    "name":
                    {
                        "$regex":
                        "Chicken Biryani",
                        "$options":
                        "i"
                    }
                },

                {
                    "name":
                    {
                        "$regex":
                        "Grilled Chicken",
                        "$options":
                        "i"
                    }
                }
            ]
        }
    )

    print(
        "PixelPlate vegetarian menu seeded/updated successfully: 20 items"
    )

    # -----------------------------------------------------
    # TABLES
    # -----------------------------------------------------

    if await db.tables.count_documents({}) == 0:

        await db.tables.insert_many(
            [
                {
                    "number":
                    str(i),

                    "status":
                    "available"
                }

                for i in range(
                    1,
                    9
                )
            ]
        )


# ---------------------------------------------------------
# STARTUP
# ---------------------------------------------------------

@app.on_event("startup")
async def startup():

    await seed()


# ---------------------------------------------------------
# ROUTER + CORS
# ---------------------------------------------------------

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pixelplate-frontend.onrender.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# SHUTDOWN
# ---------------------------------------------------------

@app.on_event("shutdown")
async def shutdown():

    mongo_client.close()
import React, { useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useNavigate,
  useParams
} from "react-router-dom";
import axios from "axios";
import QRCode from "qrcode";
import {
  BarChart3,
  ChefHat,
  ChevronRight,
  LogIn,
  Search,
  ShoppingBag,
  Star,
  X
} from "lucide-react";
import "@/App.css";

/* =====================================================
   API CONFIGURATION
===================================================== */

const API = "http://127.0.0.1:8000/api";
const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
});

/* =====================================================
   RAZORPAY LOADER
===================================================== */

const loadRazorpay = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement("script");

    script.src =
      "https://checkout.razorpay.com/v1/checkout.js";

    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);

    document.body.appendChild(script);
  });
};

/* =====================================================
   HELPERS
===================================================== */

const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN")}`;

const statusSteps = [
  "received",
  "accepted",
  "preparing",
  "ready",
  "served"
];

/* =====================================================
   QR TABLE HELPERS
===================================================== */

const normalizeTable = (value) => {
  const number = Number(value);

  if (
    Number.isInteger(number) &&
    number >= 1 &&
    number <= 8
  ) {
    return String(number);
  }

  return "";
};

const getTableFromQR = () => {
  const params = new URLSearchParams(
    window.location.search
  );

  return normalizeTable(params.get("table"));
};

/* =====================================================
   HEADER
===================================================== */

function Header({
  cartCount = 0,
  staff = false
}) {
  return (
    <header className="topbar">
      <Link
        to="/"
        className="brand"
        data-testid="brand-home"
      >
        <span className="brand-mark">
          P
        </span>

        <span>
          Pixel<span>Plate</span>

          <small>
            QR DINE SMART
          </small>
        </span>
      </Link>

      <nav data-testid="main-navigation">
        {staff ? (
          <>
            <Link
              to="/staff"
              data-testid="staff-nav"
            >
              Kitchen
            </Link>

            <Link
              to="/admin"
              data-testid="admin-nav"
            >
              Admin
            </Link>

            <Link
              to="/admin/qr"
              data-testid="qr-nav"
            >
              Table QR
            </Link>
          </>
        ) : (
          <>
            <a
              href="#menu"
              data-testid="menu-nav"
            >
              Menu
            </a>

            <Link
              to="/track"
              data-testid="track-nav"
            >
              Track order
            </Link>

            <Link
              to="/login"
              className="nav-login"
              data-testid="staff-login-link"
            >
              <LogIn size={15} />
              Staff login
            </Link>
          </>
        )}
      </nav>

      {!staff && (
        <Link
          to="/cart"
          className="cart-button"
          data-testid="cart-nav"
        >
          <ShoppingBag size={18} />

          <b>
            {cartCount}
          </b>
        </Link>
      )}
    </header>
  );
}

/* =====================================================
   CUSTOMER MENU
===================================================== */

function CustomerMenu() {
  const [items, setItems] = useState([]);

  const [search, setSearch] = useState("");

  const [category, setCategory] = useState("All");

  const [menuLoading, setMenuLoading] =
    useState(true);

  const [menuError, setMenuError] =
    useState("");

  const [cart, setCart] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("pp_cart") || "[]"
      );
    } catch {
      return [];
    }
  });

  const [tableNumber, setTableNumber] =
    useState(() =>
      getTableFromQR() ||
      localStorage.getItem(
        "pp_table_number"
      ) ||
      ""
    );

  /* =================================================
     LOAD MENU
  ================================================= */

  useEffect(() => {
    const loadMenu = async () => {
      try {
        setMenuLoading(true);
        setMenuError("");

        console.log(
          "PixelPlate API:",
          API
        );

        const response =
          await api.get("/menu");

        console.log(
          "MENU API RESPONSE:",
          response.data
        );

        const menuData =
          Array.isArray(response.data)
            ? response.data
            : [];

        setItems(menuData);
      } catch (error) {
        console.error(
          "MENU API FAILED:",
          error
        );

        console.error(
          "MENU API URL:",
          `${API}/menu`
        );

        setItems([]);

        setMenuError(
          "Unable to load the menu. Please refresh the page."
        );
      } finally {
        setMenuLoading(false);
      }
    };

    const qrTable =
      getTableFromQR();

    if (qrTable) {
      localStorage.setItem(
        "pp_table_number",
        qrTable
      );

      setTableNumber(qrTable);
    }

    loadMenu();
  }, []);

  /* =================================================
     CATEGORIES
  ================================================= */

  const categories = [
    "All",
    ...new Set(
      items
        .map((item) => item.category)
        .filter(Boolean)
    )
  ];

  /* =================================================
     FILTERED MENU
  ================================================= */

  const shown = items.filter(
    (item) => {
      const itemName =
        item.name || "";

      const description =
        item.description || "";

      const itemCategory =
        item.category || "";

      return (
        (
          category === "All" ||
          itemCategory === category
        ) &&
        `${itemName} ${description}`
          .toLowerCase()
          .includes(
            search.toLowerCase()
          )
      );
    }
  );

  /* =================================================
     ADD TO CART
  ================================================= */

  const add = (item) => {
    const existingIndex =
      cart.findIndex(
        (x) => x.id === item.id
      );

    let next;

    if (existingIndex !== -1) {
      next = [...cart];

      next[existingIndex] = {
        ...next[existingIndex],
        quantity:
          Number(
            next[existingIndex]
              .quantity || 1
          ) + 1
      };
    } else {
      next = [
        ...cart,
        {
          ...item,
          quantity: 1
        }
      ];
    }

    setCart(next);

    localStorage.setItem(
      "pp_cart",
      JSON.stringify(next)
    );
  };

  /* =================================================
     CART SUMMARY
  ================================================= */

  const cartQuantity =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(
          item.quantity || 1
        ),
      0
    );

  const cartTotal =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(
          item.price || 0
        ) *
          Number(
            item.quantity || 1
          ),
      0
    );

  return (
    <>
      <Header
        cartCount={cartQuantity}
      />

      <main className="customer-page">
        <section className="welcome-band">

          {/* FLOATING FOOD DECORATIONS */}

          <div className="floating-food food-1">
            🍕
          </div>

          <div className="floating-food food-2">
            🍔
          </div>

          <div className="floating-food food-3">
            🍟
          </div>

          <div className="floating-food food-4">
            🥗
          </div>

          <div className="floating-food food-5">
            🍩
          </div>

          <div className="floating-food food-6">
            🥤
          </div>

          {/* GLOWING PARTICLES */}

          <div className="hero-particle particle-1" />
          <div className="hero-particle particle-2" />
          <div className="hero-particle particle-3" />
          <div className="hero-particle particle-4" />
          <div className="hero-particle particle-5" />

          <div>
            <p className="eyebrow">
              {tableNumber
                ? `TABLE ${String(
                    tableNumber
                  ).padStart(
                    2,
                    "0"
                  )} · WELCOME IN`
                : "PIXELPLATE · WELCOME IN"}
            </p>

            <h1>
              Good food,
              <br />

              <em>
                no waiting.
              </em>
            </h1>

            <p className="lede">
              Explore our seasonal menu,
              make it yours, and send
              your order straight to
              the kitchen.
            </p>

            {tableNumber && (
              <div
                style={{
                  marginBottom: "18px",
                  fontSize: "14px",
                  fontWeight: 600
                }}
              >
                ✓ Table {tableNumber}
                detected from QR
              </div>
            )}

            <a
              href="#menu"
              className="primary-button"
              data-testid="browse-menu-button"
            >
              Browse the menu
              <ChevronRight size={18} />
            </a>
          </div>

          <div className="hero-dish">
            <img
              src="https://images.unsplash.com/photo-1622115837997-90c89ae689f9?w=1200"
              alt="Signature restaurant dish"
              data-testid="hero-dish-image"
            />

            <span className="hero-note">
              Chef's choice
              <br />

              <strong>
                this week
              </strong>
            </span>
          </div>
        </section>

        {/* =================================================
            MENU SECTION
        ================================================= */}

        <section
          id="menu"
          className="menu-section"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                THE MENU
              </p>

              <h2>
                Made for lingering.
              </h2>
            </div>

            <div className="search-wrap">
              <Search size={18} />

              <input
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
                placeholder="Search dishes..."
                data-testid="menu-search-input"
              />
            </div>
          </div>

          {/* CATEGORY BUTTONS */}

          {!menuLoading &&
            !menuError &&
            items.length > 0 && (
              <div className="category-row">
                {categories.map(
                  (c) => (
                    <button
                      className={
                        category === c
                          ? "category active"
                          : "category"
                      }
                      onClick={() =>
                        setCategory(c)
                      }
                      key={c}
                      data-testid={`category-${c
                        .toLowerCase()
                        .replaceAll(
                          " ",
                          "-"
                        )}`}
                    >
                      {c}
                    </button>
                  )
                )}
              </div>
            )}

          {/* MENU LOADING */}

          {menuLoading && (
            <div className="empty-state">
              <ChefHat size={30} />

              <h3>
                Loading the menu...
              </h3>

              <p>
                Fresh dishes are on their way.
              </p>
            </div>
          )}

          {/* MENU ERROR */}

          {!menuLoading &&
            menuError && (
              <div className="empty-state">
                <ChefHat size={30} />

                <h3>
                  Menu unavailable
                </h3>

                <p>
                  {menuError}
                </p>

                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    window.location.reload()
                  }
                >
                  Refresh menu
                </button>
              </div>
            )}

          {/* MENU GRID */}

          {!menuLoading &&
            !menuError &&
            items.length > 0 && (
              <div className="menu-grid">
                {shown.map(
                  (item) => (
                    <article
                      className="dish-card"
                      key={item.id}
                      data-testid={`menu-item-${item.id}`}
                    >
                      <div className="dish-image">
                        <img
                          src={
                            item.image_url
                          }
                          alt={
                            item.name
                          }
                        />

                        {item.featured && (
                          <span className="featured">
                            FEATURED
                          </span>
                        )}
                      </div>

                      <div className="dish-copy">
                        <div className="dish-meta">
                          <span>
                            {
                              item.category
                            }
                          </span>

                          <span>
                            <Star
                              size={13}
                              fill="currentColor"
                            />
                            {" "}
                            {
                              item.rating ??
                              "4.5"
                            }
                          </span>
                        </div>

                        <h3>
                          {
                            item.name
                          }
                        </h3>

                        <p>
                          {
                            item.description
                          }
                        </p>

                        <div className="dish-bottom">
                          <strong>
                            {money(
                              item.price
                            )}
                          </strong>

                          <button
                            className="add-button"
                            onClick={() =>
                              add(
                                item
                              )
                            }
                            data-testid={`add-item-${item.id}`}
                          >
                            Add

                            <span>
                              +
                            </span>
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                )}
              </div>
            )}

          {/* SEARCH EMPTY */}

          {!menuLoading &&
            !menuError &&
            items.length > 0 &&
            !shown.length && (
              <div
                className="empty-state"
                data-testid="menu-empty-state"
              >
                No dishes match that search.
              </div>
            )}

          {/* NO DATABASE ITEMS */}

          {!menuLoading &&
            !menuError &&
            items.length === 0 && (
              <div
                className="empty-state"
                data-testid="menu-empty-state"
              >
                No menu items are available.
              </div>
            )}
        </section>
      </main>

      {/* =================================================
          FLOATING VIEW CART
      ================================================= */}

      {cart.length > 0 && (
        <Link
          to="/cart"
          className="floating-cart-bar"
        >
          <div className="floating-cart-left">
            <div className="floating-cart-icon">
              <ShoppingBag size={19} />
            </div>

            <div>
              <strong>
                View Cart
              </strong>

              <span>
                {cartQuantity}{" "}
                {cartQuantity === 1
                  ? "item"
                  : "items"}
              </span>
            </div>
          </div>

          <div className="floating-cart-total">
            <strong>
              {money(cartTotal)}
            </strong>

            <ChevronRight size={20} />
          </div>
        </Link>
      )}
    </>
  );
}

/* =====================================================
   CART
===================================================== */

function Cart() {
  const [cart, setCart] =
    useState([]);

  useEffect(() => {
    try {
      const saved =
        JSON.parse(
          localStorage.getItem(
            "pp_cart"
          ) || "[]"
        );

      setCart(
        Array.isArray(saved)
          ? saved
          : []
      );
    } catch {
      setCart([]);
    }
  }, []);

  const saveCart = (next) => {
    setCart(next);

    localStorage.setItem(
      "pp_cart",
      JSON.stringify(next)
    );
  };

  const increase = (index) => {
    const next = [...cart];

    next[index] = {
      ...next[index],
      quantity:
        Number(
          next[index].quantity || 1
        ) + 1
    };

    saveCart(next);
  };

  const decrease = (index) => {
    const next = [...cart];

    const quantity =
      Number(
        next[index].quantity || 1
      );

    if (quantity <= 1) {
      next.splice(index, 1);
    } else {
      next[index] = {
        ...next[index],
        quantity:
          quantity - 1
      };
    }

    saveCart(next);
  };

  const remove = (index) => {
    const next = [...cart];

    next.splice(index, 1);

    saveCart(next);
  };

  const total =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(
          item.price || 0
        ) *
          Number(
            item.quantity || 1
          ),
      0
    );

  const totalItems =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(
          item.quantity || 1
        ),
      0
    );

  return (
    <>
      <Header
        cartCount={totalItems}
      />

      <main className="narrow-page cart-page">
        <p className="eyebrow">
          YOUR CART
        </p>

        <h1>
          Ready when you are.
        </h1>

        <p className="lede">
          Review your dishes before heading
          to checkout.
        </p>

        {cart.length === 0 ? (
          <div className="empty-state">
            <ShoppingBag size={36} />

            <h3>
              Your cart is empty.
            </h3>

            <p>
              Add something delicious from
              the menu to get started.
            </p>

            <Link
              to="/"
              className="primary-button"
            >
              Browse menu
            </Link>
          </div>
        ) : (
          <div className="cart-layout">
            <div className="cart-items">
              {cart.map(
                (item, index) => {
                  const quantity =
                    Number(
                      item.quantity || 1
                    );

                  const itemTotal =
                    Number(
                      item.price || 0
                    ) *
                    quantity;

                  return (
                    <div
                      className="cart-item"
                      key={`${item.id}-${index}`}
                    >
                      <div className="cart-item-image">
                        <img
                          src={
                            item.image_url
                          }
                          alt={
                            item.name
                          }
                        />
                      </div>

                      <div className="cart-item-info">
                        <div>
                          <h3>
                            {
                              item.name
                            }
                          </h3>

                          <p>
                            {money(
                              item.price
                            )}{" "}
                            each
                          </p>
                        </div>

                        <div className="cart-item-bottom">
                          <div className="quantity-control">
                            <button
                              type="button"
                              onClick={() =>
                                decrease(
                                  index
                                )
                              }
                              aria-label={`Decrease ${item.name}`}
                            >
                              −
                            </button>

                            <span>
                              {
                                quantity
                              }
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                increase(
                                  index
                                )
                              }
                              aria-label={`Increase ${item.name}`}
                            >
                              +
                            </button>
                          </div>

                          <strong>
                            {money(
                              itemTotal
                            )}
                          </strong>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="cart-remove"
                        onClick={() =>
                          remove(
                            index
                          )
                        }
                        aria-label={`Remove ${item.name}`}
                      >
                        <X size={17} />
                      </button>
                    </div>
                  );
                }
              )}
            </div>

            <aside className="cart-summary">
              <p className="eyebrow">
                ORDER SUMMARY
              </p>

              <div className="summary-row">
                <span>
                  Items
                </span>

                <strong>
                  {totalItems}
                </strong>
              </div>

              <div className="summary-row">
                <span>
                  Subtotal
                </span>

                <strong>
                  {money(total)}
                </strong>
              </div>

              <div className="summary-divider" />

              <div className="summary-total">
                <span>
                  Total
                </span>

                <strong>
                  {money(total)}
                </strong>
              </div>

              <Link
                to="/checkout"
                className="primary-button checkout-button"
              >
                Continue to checkout

                <ChevronRight size={18} />
              </Link>

              <Link
                to="/"
                className="continue-shopping"
              >
                ← Continue browsing
              </Link>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}

/* =====================================================
   CHECKOUT
===================================================== */

function Checkout() {
  const [cart] =
    useState(() => {
      try {
        return JSON.parse(
          localStorage.getItem(
            "pp_cart"
          ) || "[]"
        );
      } catch {
        return [];
      }
    });

  const savedTable =
    normalizeTable(
      localStorage.getItem(
        "pp_table_number"
      )
    );

  const [form, setForm] =
    useState({
      customer_name: "",
      phone: "",
      table_number: savedTable
    });

  const [message, setMessage] =
    useState("");

  const [processing, setProcessing] =
    useState(false);

  const total =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(
          item.price || 0
        ) *
          Number(
            item.quantity || 1
          ),
      0
    );

  const hasQRTable =
    Boolean(savedTable);

  const start = async () => {
    try {
      setMessage("");
      setProcessing(true);

      if (!form.customer_name) {
        setMessage(
          "Please enter your name."
        );

        setProcessing(false);
        return;
      }

      if (!form.phone) {
        setMessage(
          "Please enter your mobile number."
        );

        setProcessing(false);
        return;
      }

      if (!form.table_number) {
        setMessage(
          "Please scan the table QR code or enter a table number."
        );

        setProcessing(false);
        return;
      }

      if (!cart.length) {
        setMessage(
          "Your cart is empty."
        );

        setProcessing(false);
        return;
      }

      const loaded =
        await loadRazorpay();

      if (!loaded) {
        setMessage(
          "Payment system could not be loaded. Please check your internet connection."
        );

        setProcessing(false);
        return;
      }

      const payload = {
        ...form,

        items: cart.map(
          (item) => ({
            item_id: item.id,
            name: item.name,
            quantity:
              Number(
                item.quantity || 1
              ),
            price:
              Number(
                item.price || 0
              ),
            add_ons: []
          })
        ),

        total
      };

      setMessage(
        "Creating secure payment..."
      );

      const response =
        await api.post(
          "/payments/create-order",
          payload
        );

      if (
        !response.data?.available
      ) {
        setMessage(
          response.data?.message ||
            "Razorpay payment is not available."
        );

        setProcessing(false);
        return;
      }

      const razorpayOrder =
        response.data.order;

      const options = {
        key:
          response.data.key_id,

        amount:
          razorpayOrder.amount,

        currency:
          razorpayOrder.currency,

        name:
          "PixelPlate",

        description:
          "Restaurant Order",

        order_id:
          razorpayOrder.id,

        prefill: {
          name:
            form.customer_name,

          contact:
            form.phone
        },

        theme: {
          color:
            "#111111"
        },

        handler:
          async function (
            paymentResponse
          ) {
            try {
              setMessage(
                "Verifying payment..."
              );

              const verify =
                await api.post(
                  "/payments/verify",
                  paymentResponse
                );

              localStorage.setItem(
                "pp_last_order",
                verify.data.id
              );

              localStorage.removeItem(
                "pp_cart"
              );

              localStorage.removeItem(
                "pp_table_number"
              );

              window.location.href =
                `/order/${verify.data.id}`;
            } catch (error) {
              console.error(
                "Payment verification error:",
                error
              );

              setProcessing(false);

              const detail =
                error.response?.data
                  ?.detail;

              setMessage(
                typeof detail ===
                  "string"
                  ? detail
                  : Array.isArray(detail)
                  ? detail
                      .map(
                        (item) =>
                          item?.msg ||
                          "Invalid input"
                      )
                      .join(", ")
                  : detail?.msg ||
                    "Payment verification failed. Please contact staff."
              );
            }
          },

        modal: {
          ondismiss:
            function () {
              setProcessing(false);

              setMessage(
                "Payment cancelled."
              );
            }
        }
      };

      const razorpay =
        new window.Razorpay(
          options
        );

      razorpay.on(
        "payment.failed",
        function () {
          setProcessing(false);

          setMessage(
            "Payment failed. Please try again."
          );
        }
      );

      razorpay.open();
    } catch (error) {
      console.error(
        "Razorpay error:",
        error
      );

      setProcessing(false);

      const detail =
        error.response?.data
          ?.detail;

      setMessage(
        typeof detail ===
          "string"
          ? detail
          : Array.isArray(detail)
          ? detail
              .map(
                (item) =>
                  item?.msg ||
                  "Invalid input"
              )
              .join(", ")
          : detail?.msg ||
            "We could not start the payment. Please try again."
      );
    }
  };

  return (
    <>
      <Header
        cartCount={
          cart.reduce(
            (sum, item) =>
              sum +
              Number(
                item.quantity || 1
              ),
            0
          )
        }
      />

      <main className="narrow-page">
        <p className="eyebrow">
          CHECKOUT
        </p>

        <h1>
          Almost at the table.
        </h1>

        <div className="checkout-layout">
          <section className="form-panel">
            <label>
              Your name

              <input
                value={
                  form.customer_name
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    customer_name:
                      e.target.value
                  })
                }
                placeholder="e.g. Ananya"
                data-testid="checkout-name-input"
              />
            </label>

            <label>
              Mobile number

              <input
                value={
                  form.phone
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    phone:
                      e.target.value
                  })
                }
                placeholder="10-digit number"
                data-testid="checkout-phone-input"
              />
            </label>

            <label>
              Table number

              {hasQRTable && (
                <span
                  style={{
                    display:
                      "block",
                    fontSize:
                      "12px",
                    marginTop:
                      "4px",
                    marginBottom:
                      "6px",
                    fontWeight:
                      600
                  }}
                >
                  ✓ Detected from table QR
                </span>
              )}

              <input
                value={
                  form.table_number
                }
                readOnly={
                  hasQRTable
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    table_number:
                      normalizeTable(
                        e.target.value
                      )
                  })
                }
                placeholder={
                  hasQRTable
                    ? "Detected automatically"
                    : "Enter table number"
                }
                data-testid="checkout-table-input"
              />
            </label>

            <div className="payment-note">
              <span>
                ◈
              </span>

              <div>
                <strong>
                  Razorpay Test Payment
                </strong>

                <p>
                  Sandbox payment · No real
                  money will be charged.
                </p>
              </div>
            </div>

            {message && (
              <div
                className="error-state"
                data-testid="payment-error-message"
              >
                {message}
              </div>
            )}

            <button
              className="primary-button full"
              disabled={
                processing ||
                !form.customer_name ||
                !form.phone ||
                !form.table_number ||
                !cart.length
              }
              onClick={start}
              data-testid="pay-now-button"
            >
              {processing
                ? "Processing..."
                : `Pay ${money(total)}`}

              <ChevronRight size={18} />
            </button>
          </section>

          <aside className="summary">
            <p>
              At a glance
            </p>

            {cart.map(
              (item) => {
                const quantity =
                  Number(
                    item.quantity || 1
                  );

                const itemTotal =
                  Number(
                    item.price || 0
                  ) *
                  quantity;

                return (
                  <div
                    key={item.id}
                  >
                    <span>
                      {quantity} ×{" "}
                      {item.name}
                    </span>

                    <strong>
                      {money(
                        itemTotal
                      )}
                    </strong>
                  </div>
                );
              }
            )}

            <hr />

            <div className="total">
              <span>
                Total
              </span>

              <strong>
                {money(total)}
              </strong>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

/* =====================================================
   ORDER TRACKING
===================================================== */

function Track() {
  const { id: urlId } =
    useParams();

  const [id, setId] =
    useState(
      () =>
        urlId ||
        localStorage.getItem(
          "pp_last_order"
        ) ||
        ""
    );

  const [order, setOrder] =
    useState(null);

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const find = async (
    orderId = id,
    silent = false
  ) => {
    if (!orderId) return;

    try {
      if (!silent) {
        setLoading(true);
      }

      const response =
        await api.get(
          `/orders/${orderId}`
        );

      setOrder(
        response.data
      );

      setError("");

      localStorage.setItem(
        "pp_last_order",
        orderId
      );
    } catch (e) {
      if (!silent) {
        setOrder(null);

        setError(
          "We couldn't find that order reference."
        );
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const orderId =
      urlId ||
      localStorage.getItem(
        "pp_last_order"
      );

    if (!orderId) return;

    setId(orderId);

    find(orderId);
  }, [urlId]);

  useEffect(() => {
    if (!id) return;

    const timer =
      setInterval(
        () => {
          find(
            id,
            true
          );
        },
        5000
      );

    return () =>
      clearInterval(
        timer
      );
  }, [id]);

  const currentStep =
    statusSteps.indexOf(
      order?.status
    );

  const statusLabels = {
    received:
      "Order received",

    accepted:
      "Order accepted",

    preparing:
      "Preparing your food",

    ready:
      "Ready to serve",

    served:
      "Served"
  };

  const statusDescriptions = {
    received:
      "Your order has been received by the kitchen.",

    accepted:
      "The kitchen has accepted your order.",

    preparing:
      "Your food is being freshly prepared.",

    ready:
      "Your order is ready. Enjoy!",

    served:
      "Your order has been served. Enjoy your meal!"
  };

  return (
    <>
      <Header />

      <main className="narrow-page track-page">
        <p className="eyebrow">
          ORDER TRACKING
        </p>

        <h1>
          Where's dinner?
        </h1>

        <p className="lede">
          Follow your order from the kitchen
          to your table in real time.
        </p>

        <div className="track-search">
          <input
            value={id}
            onChange={(e) =>
              setId(
                e.target.value.toUpperCase()
              )
            }
            placeholder="PP-XXXXXXXX"
            data-testid="track-reference-input"
          />

          <button
            className="primary-button"
            onClick={() =>
              find()
            }
            disabled={
              loading || !id
            }
            data-testid="track-order-button"
          >
            {loading
              ? "Checking..."
              : "Track order"}
          </button>
        </div>

        {error && (
          <div
            className="error-state"
            data-testid="track-error-message"
          >
            {error}
          </div>
        )}

        {order && (
          <div
            className="tracking-card"
            data-testid="tracking-result"
          >
            <div className="tracking-head">
              <div>
                <p className="eyebrow">
                  {order.id}
                </p>

                <h2>
                  {order.status ===
                  "served"
                    ? "Enjoy your meal! 🍽️"
                    : "Your order is on its way."}
                </h2>
              </div>

              <span className="status-pill">
                {
                  statusLabels[
                    order.status
                  ]
                }
              </span>
            </div>

            <div
              style={{
                marginTop:
                  "18px",
                padding:
                  "16px 18px",
                borderRadius:
                  "14px",
                background:
                  "rgba(208,58,39,0.07)",
                border:
                  "1px solid rgba(208,58,39,0.12)"
              }}
            >
              <strong>
                {
                  statusLabels[
                    order.status
                  ]
                }
              </strong>

              <p
                style={{
                  margin:
                    "5px 0 0",
                  opacity:
                    0.7
                }}
              >
                {
                  statusDescriptions[
                    order.status
                  ]
                }
              </p>
            </div>

            <div className="steps">
              {statusSteps.map(
                (s, i) => {
                  const completed =
                    currentStep >=
                    i;

                  return (
                    <div
                      className={
                        completed
                          ? "step done"
                          : "step"
                      }
                      key={s}
                    >
                      <span>
                        {completed
                          ? "✓"
                          : i + 1}
                      </span>

                      <small>
                        {
                          statusLabels[
                            s
                          ]
                        }
                      </small>
                    </div>
                  );
                }
              )}
            </div>

            <div className="tracking-items">
              <p
                className="eyebrow"
                style={{
                  marginBottom:
                    "10px"
                }}
              >
                YOUR ORDER
              </p>

              {order.items?.map(
                (x, index) => (
                  <div
                    key={`${x.item_id}-${index}`}
                  >
                    <span>
                      {x.quantity} ×{" "}
                      {x.name}
                    </span>

                    <strong>
                      {money(
                        Number(
                          x.price || 0
                        ) *
                          Number(
                            x.quantity ||
                              1
                          )
                      )}
                    </strong>
                  </div>
                )
              )}
            </div>

            <div
              style={{
                marginTop:
                  "18px",
                paddingTop:
                  "16px",
                borderTop:
                  "1px solid rgba(0,0,0,0.08)",
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center"
              }}
            >
              <span>
                Total paid
              </span>

              <strong
                style={{
                  fontSize:
                    "20px"
                }}
              >
                {money(
                  order.total
                )}
              </strong>
            </div>

            {order.status !==
              "served" && (
              <div
                style={{
                  marginTop:
                    "18px",
                  fontSize:
                    "12px",
                  opacity:
                    0.65,
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap:
                    "7px"
                }}
              >
                <span
                  style={{
                    width:
                      "7px",
                    height:
                      "7px",
                    borderRadius:
                      "50%",
                    background:
                      "#D03A27",
                    display:
                      "inline-block",
                    animation:
                      "pulse 1.5s infinite"
                  }}
                />

                Live updates enabled
              </div>
            )}
          </div>
        )}

        {!order &&
          !error &&
          !loading && (
          <div
            className="empty-state"
            style={{
              marginTop:
                "28px"
            }}
          >
            <ShoppingBag
              size={30}
            />

            <h3>
              Track your PixelPlate order.
            </h3>

            <p>
              Your latest order will appear
              here automatically after payment.
            </p>
          </div>
        )}
      </main>
    </>
  );
}

/* =====================================================
   LOGIN
===================================================== */

function Login() {
  const [loginType, setLoginType] =
    useState("staff");

  const [email, setEmail] =
  useState(
    "staff@pixelplate.com"
  );
    const [password, setPassword] =
  useState(
    "staff123"
  );

  const [error, setError] =
    useState("");

  const nav =
    useNavigate();

  const selectLoginType =
    (type) => {
      setLoginType(type);
      setError("");

     if (
  type ===
  "admin"
) {
  setEmail(
    "admin@pixelplate.com"
  );

  setPassword(
    "admin123"
  );
      } else {
        setEmail(
          "staff@pixelplate.com"
        );

        setPassword(
          "staff123"
        );
      }
    };

  const submit =
    async (e) => {
      e.preventDefault();

      setError("");

      try {
        const response =
          await api.post(
            "/auth/login",
            {
              email,
              password
            }
          );

        localStorage.setItem(
          "pp_token",
          response.data.token
        );

        if (
          response.data.user.role ===
          "admin"
        ) {
          nav("/admin");
        } else {
          nav("/staff");
        }
      } catch (error) {
        const detail =
          error.response?.data
            ?.detail;

        setError(
          typeof detail ===
            "string"
            ? detail
            : Array.isArray(detail)
            ? detail
                .map(
                  (item) =>
                    item?.msg ||
                    "Invalid input"
                )
                .join(", ")
            : detail?.msg ||
              "Unable to sign in"
        );
      }
    };

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">
          P
        </span>

        <h2>
          PixelPlate
        </h2>

        <p>
          Kitchen operations,
          beautifully in sync.
        </p>
      </div>

      <form
        className="auth-form"
        onSubmit={submit}
      >
        <p className="eyebrow">
          TEAM ACCESS
        </p>

        <h1>
          Welcome back.
        </h1>

        <div
          style={{
            display:
              "grid",
            gridTemplateColumns:
              "1fr 1fr",
            gap:
              "10px",
            marginBottom:
              "20px"
          }}
        >
          <button
            type="button"
            onClick={() =>
              selectLoginType(
                "staff"
              )
            }
            style={{
              padding:
                "12px",
              borderRadius:
                "10px",
              border:
                loginType ===
                "staff"
                  ? "2px solid #111"
                  : "1px solid #ddd",
              background:
                loginType ===
                "staff"
                  ? "#111"
                  : "#fff",
              color:
                loginType ===
                "staff"
                  ? "#fff"
                  : "#111",
              cursor:
                "pointer",
              fontWeight:
                600
            }}
          >
            Staff Login
          </button>

          <button
            type="button"
            onClick={() =>
              selectLoginType(
                "admin"
              )
            }
            style={{
              padding:
                "12px",
              borderRadius:
                "10px",
              border:
                loginType ===
                "admin"
                  ? "2px solid #111"
                  : "1px solid #ddd",
              background:
                loginType ===
                "admin"
                  ? "#111"
                  : "#fff",
              color:
                loginType ===
                "admin"
                  ? "#fff"
                  : "#111",
              cursor:
                "pointer",
              fontWeight:
                600
            }}
          >
            Admin Login
          </button>
        </div>

        <label>
          Email

          <input
            type="email"
            value={email}
            onChange={(e) =>
              setEmail(
                e.target.value
              )
            }
            data-testid="login-email-input"
          />
        </label>

        <label>
          Password

          <input
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(
                e.target.value
              )
            }
            data-testid="login-password-input"
          />
        </label>

        {error && (
          <div
            className="error-state"
            data-testid="login-error-message"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          className="primary-button full"
          data-testid="login-submit-button"
        >
          {loginType ===
          "admin"
            ? "Sign in as Admin"
            : "Sign in as Staff"}

          <ChevronRight
            size={18}
          />
        </button>

        <Link
          to="/"
          className="back-link"
          data-testid="back-to-menu-link"
        >
          ← Back to menu
        </Link>
      </form>
    </main>
  );
}

/* =====================================================
   STAFF / ADMIN
===================================================== */

function Staff({
  admin = false
}) {
  const [orders, setOrders] =
    useState([]);

  const [analytics, setAnalytics] =
    useState(null);

  const [salesPeriod, setSalesPeriod] =
    useState("daily");

  const [updatingOrder, setUpdatingOrder] =
    useState(null);

  const [newOrders, setNewOrders] =
    useState({});

  const firstLoadRef =
    React.useRef(true);

  const previousOrderIdsRef =
    React.useRef(
      new Set()
    );

  const getAuthHeaders = () => ({
    Authorization:
      `Bearer ${localStorage.getItem(
        "pp_token"
      )}`
  });

  const load = async () => {
    try {
      const response =
        await api.get(
          "/orders",
          {
            headers:
              getAuthHeaders()
          }
        );

      const freshOrders =
        Array.isArray(
          response.data
        )
          ? response.data
          : [];

      if (
        !firstLoadRef.current
      ) {
        const previousIds =
          previousOrderIdsRef.current;

        const newlyCreated =
          freshOrders.filter(
            (order) =>
              !previousIds.has(
                order.id
              )
          );

        if (
          newlyCreated.length
        ) {
          const newMap = {};

          newlyCreated.forEach(
            (order) => {
              newMap[
                order.id
              ] = true;
            }
          );

          setNewOrders(
            (prev) => ({
              ...prev,
              ...newMap
            })
          );

          if (
            "Notification" in
              window &&
            Notification.permission ===
              "granted"
          ) {
            newlyCreated.forEach(
              (order) => {
                new Notification(
                  "New PixelPlate Order",
                  {
                    body:
                      `Table ${order.table_number} · ${order.customer_name}`
                  }
                );
              }
            );
          }
        }
      }

      previousOrderIdsRef.current =
        new Set(
          freshOrders.map(
            (order) =>
              order.id
          )
        );

      firstLoadRef.current =
        false;

      setOrders(
        freshOrders
      );
    } catch (error) {
      console.error(
        "Orders loading failed:",
        error
      );
    }

    if (admin) {
      try {
        const analyticsResponse =
          await api.get(
            "/admin/analytics",
            {
              headers:
                getAuthHeaders()
            }
          );

        setAnalytics(
          analyticsResponse.data
        );
      } catch (error) {
        console.error(
          "Analytics loading failed:",
          error
        );
      }
    }
  };

  useEffect(() => {
    if (
      "Notification" in
        window &&
      Notification.permission ===
        "default"
    ) {
      Notification.requestPermission()
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    firstLoadRef.current =
      true;

    previousOrderIdsRef.current =
      new Set();

    load();

    const timer =
      setInterval(
        load,
        1000
      );

    return () =>
      clearInterval(
        timer
      );
  }, [admin]);

  useEffect(() => {
    const timers = [];

    Object.keys(
      newOrders
    ).forEach(
      (orderId) => {
        const timer =
          setTimeout(
            () => {
              setNewOrders(
                (prev) => {
                  const next = {
                    ...prev
                  };

                  delete next[
                    orderId
                  ];

                  return next;
                }
              );
            },
            10000
          );

        timers.push(
          timer
        );
      }
    );

    return () => {
      timers.forEach(
        clearTimeout
      );
    };
  }, [newOrders]);

  const change =
    async (
      id,
      status
    ) => {
      if (
        updatingOrder ===
        id
      ) {
        return;
      }

      try {
        setUpdatingOrder(
          id
        );

        setOrders(
          (prev) =>
            prev.map(
              (order) =>
                order.id ===
                id
                  ? {
                      ...order,
                      status
                    }
                  : order
            )
        );

        await api.patch(
          `/orders/${id}/status`,
          {
            status
          },
          {
            headers:
              getAuthHeaders()
          }
        );

        await load();
      } catch (error) {
        console.error(
          "Status update failed:",
          error
        );

        await load();

        const detail =
          error.response?.data
            ?.detail;

        alert(
          typeof detail ===
            "string"
            ? detail
            : Array.isArray(detail)
            ? detail
                .map(
                  (item) =>
                    item?.msg ||
                    "Invalid input"
                )
                .join(", ")
            : detail?.msg ||
              "Unable to update order status."
        );
      } finally {
        setUpdatingOrder(
          null
        );
      }
    };

  const statusButtons = [
    {
      value:
        "accepted",
      label:
        "Accept"
    },
    {
      value:
        "preparing",
      label:
        "Preparing"
    },
    {
      value:
        "ready",
      label:
        "Ready"
    },
    {
      value:
        "served",
      label:
        "Served"
    }
  ];

  const salesData =
    analytics?.sales?.[
      salesPeriod
    ] || [];

  const maxRevenue =
    Math.max(
      ...salesData.map(
        (x) =>
          Number(
            x.revenue ||
              0
          )
      ),
      1
    );

  return (
    <>
      <Header staff />

      <main className="ops-page">
        <div className="ops-head">
          <div>
            <p className="eyebrow">
              {admin
                ? "ADMIN CONSOLE"
                : "KITCHEN DISPLAY"}
            </p>

            <h1>
              {admin
                ? "The pulse of PixelPlate."
                : "Good morning, kitchen."}
            </h1>
          </div>

          <span className="live-dot">
            <i />
            Live updates
          </span>
        </div>

        {/* =================================================
            ADMIN ANALYTICS
        ================================================= */}

        {admin &&
          analytics && (
          <>
            <div
              className="kpi-grid"
              style={{
                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))"
              }}
            >
              <div className="kpi">
                <span>
                  Today's orders
                </span>

                <strong>
                  {
                    analytics.today_orders
                  }
                </strong>

                <small>
                  Paid orders today
                </small>
              </div>

              <div className="kpi">
                <span>
                  Today's revenue
                </span>

                <strong>
                  {money(
                    analytics.today_revenue
                  )}
                </strong>

                <small>
                  Revenue generated today
                </small>
              </div>

              <div className="kpi">
                <span>
                  Most ordered dish
                </span>

                <strong
                  style={{
                    fontSize:
                      "20px"
                  }}
                >
                  {
                    analytics.most_ordered_dish
                  }
                </strong>

                <small>
                  {
                    analytics.most_ordered_quantity
                  }{" "}
                  sold
                </small>
              </div>

              <div className="kpi">
                <span>
                  Total customers
                </span>

                <strong>
                  {
                    analytics.total_customers
                  }
                </strong>

                <small>
                  Unique customers
                </small>
              </div>

              <div className="kpi">
                <span>
                  Pending orders
                </span>

                <strong>
                  {
                    analytics.pending_orders
                  }
                </strong>

                <small>
                  Currently in kitchen
                </small>
              </div>

              <div className="kpi">
                <span>
                  Completed orders
                </span>

                <strong>
                  {
                    analytics.completed_orders
                  }
                </strong>

                <small>
                  Successfully served
                </small>
              </div>
            </div>

            {/* SALES GRAPH */}

            <section
              style={{
                marginTop:
                  "28px",
                padding:
                  "24px",
                border:
                  "1px solid rgba(0,0,0,0.08)",
                borderRadius:
                  "18px",
                background:
                  "#fff"
              }}
            >
              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                  alignItems:
                    "center",
                  gap:
                    "16px",
                  marginBottom:
                    "24px",
                  flexWrap:
                    "wrap"
                }}
              >
                <div>
                  <p className="eyebrow">
                    SALES PERFORMANCE
                  </p>

                  <h2
                    style={{
                      margin:
                        "4px 0 0"
                    }}
                  >
                    Revenue overview
                  </h2>
                </div>

                <div
                  style={{
                    display:
                      "flex",
                    gap:
                      "8px"
                  }}
                >
                  {[
                    [
                      "daily",
                      "Daily"
                    ],
                    [
                      "weekly",
                      "Weekly"
                    ],
                    [
                      "monthly",
                      "Monthly"
                    ]
                  ].map(
                    ([value, label]) => (
                      <button
                        key={
                          value
                        }
                        onClick={() =>
                          setSalesPeriod(
                            value
                          )
                        }
                        style={{
                          padding:
                            "9px 14px",
                          borderRadius:
                            "10px",
                          border:
                            salesPeriod ===
                            value
                              ? "2px solid #111"
                              : "1px solid #ddd",
                          background:
                            salesPeriod ===
                            value
                              ? "#111"
                              : "#fff",
                          color:
                            salesPeriod ===
                            value
                              ? "#fff"
                              : "#111",
                          cursor:
                            "pointer",
                          fontWeight:
                            600
                        }}
                      >
                        {label}
                      </button>
                    )
                  )}
                </div>
              </div>

              {salesData.length ? (
                <div
                  style={{
                    display:
                      "flex",
                    alignItems:
                      "flex-end",
                    gap:
                      "12px",
                    height:
                      "260px",
                    padding:
                      "20px 5px 0",
                    borderBottom:
                      "1px solid #ddd"
                  }}
                >
                  {salesData.map(
                    (
                      item,
                      index
                    ) => {
                      const revenue =
                        Number(
                          item.revenue ||
                            0
                        );

                      const height =
                        Math.max(
                          (revenue /
                            maxRevenue) *
                            190,
                          revenue >
                            0
                            ? 12
                            : 4
                        );

                      return (
                        <div
                          key={`${item.label}-${index}`}
                          style={{
                            flex:
                              1,
                            height:
                              "100%",
                            display:
                              "flex",
                            flexDirection:
                              "column",
                            justifyContent:
                              "flex-end",
                            alignItems:
                              "center",
                            minWidth:
                              "30px"
                          }}
                        >
                          <small
                            style={{
                              marginBottom:
                                "6px",
                              fontWeight:
                                600,
                              fontSize:
                                "11px"
                            }}
                          >
                            {money(
                              revenue
                            )}
                          </small>

                          <div
                            title={`${item.label}: ${money(
                              revenue
                            )}`}
                            style={{
                              width:
                                "70%",
                              maxWidth:
                                "52px",
                              height:
                                `${height}px`,
                              background:
                                "#111",
                              borderRadius:
                                "8px 8px 2px 2px"
                            }}
                          />

                          <small
                            style={{
                              marginTop:
                                "8px",
                              fontSize:
                                "11px",
                              whiteSpace:
                                "nowrap"
                            }}
                          >
                            {
                              item.label
                            }
                          </small>
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  No sales data available yet.
                </div>
              )}
            </section>

            {/* BUSINESS INSIGHT */}

            <section
              className="insight-band"
              style={{
                marginTop:
                  "20px"
              }}
            >
              <BarChart3
                size={21}
              />

              <div>
                <strong>
                  Business insight
                </strong>

                <p>
                  {
                    analytics.insight
                  }
                </p>
              </div>
            </section>

            {/* ALL TIME KPIs */}

            <div
              className="kpi-grid"
              style={{
                marginTop:
                  "20px",
                gridTemplateColumns:
                  "repeat(4, minmax(0, 1fr))"
              }}
            >
              <div className="kpi">
                <span>
                  Total revenue
                </span>

                <strong>
                  {money(
                    analytics.total_revenue
                  )}
                </strong>

                <small>
                  All paid orders
                </small>
              </div>

              <div className="kpi">
                <span>
                  Total orders
                </span>

                <strong>
                  {
                    analytics.total_orders
                  }
                </strong>

                <small>
                  All time
                </small>
              </div>

              <div className="kpi">
                <span>
                  Peak ordering
                </span>

                <strong
                  style={{
                    fontSize:
                      "20px"
                  }}
                >
                  {
                    analytics.peak_hour
                  }
                </strong>

                <small>
                  Busiest time
                </small>
              </div>

              <div className="kpi">
                <span>
                  Top seller
                </span>

                <strong
                  style={{
                    fontSize:
                      "20px"
                  }}
                >
                  {analytics
                    .top_items?.[0]
                    ?.name ||
                    "—"}
                </strong>

                <small>
                  {analytics
                    .top_items?.[0]
                    ?.quantity ||
                    0}{" "}
                  sold
                </small>
              </div>
            </div>

            {/* TOP 5 DISHES */}

            <section
              style={{
                marginTop:
                  "24px",
                padding:
                  "24px",
                border:
                  "1px solid rgba(0,0,0,0.08)",
                borderRadius:
                  "18px",
                background:
                  "#fff"
              }}
            >
              <p className="eyebrow">
                MENU PERFORMANCE
              </p>

              <h2
                style={{
                  marginTop:
                    "4px"
                }}
              >
                Top 5 dishes
              </h2>

              <div
                style={{
                  marginTop:
                    "18px"
                }}
              >
                {analytics.top_items
                  ?.length ? (
                  analytics.top_items.map(
                    (
                      item,
                      index
                    ) => (
                      <div
                        key={
                          item.name
                        }
                        style={{
                          display:
                            "flex",
                          alignItems:
                            "center",
                          justifyContent:
                            "space-between",
                          padding:
                            "14px 0",
                          borderBottom:
                            index <
                            analytics
                              .top_items
                              .length -
                              1
                              ? "1px solid #eee"
                              : "none"
                        }}
                      >
                        <div
                          style={{
                            display:
                              "flex",
                            alignItems:
                              "center",
                            gap:
                              "12px"
                          }}
                        >
                          <strong>
                            #
                            {index +
                              1}
                          </strong>

                          <span>
                            {
                              item.name
                            }
                          </span>
                        </div>

                        <strong>
                          {
                            item.quantity
                          }{" "}
                          sold
                        </strong>
                      </div>
                    )
                  )
                ) : (
                  <p>
                    No dish sales recorded yet.
                  </p>
                )}
              </div>
            </section>
          </>
        )}

        {/* =================================================
            ORDERS SECTION
        ================================================= */}

        <div
          className="ops-toolbar"
          style={{
            marginTop:
              admin &&
              analytics
                ? "32px"
                : undefined
          }}
        >
          <div>
            <h2>
              {admin
                ? "Recent orders"
                : "Incoming orders"}
            </h2>

            {!admin && (
              <small
                style={{
                  display:
                    "block",
                  marginTop:
                    "4px",
                  opacity:
                    0.6
                }}
              >
                Orders refresh automatically
              </small>
            )}
          </div>

          <span>
            {orders.length} orders
          </span>
        </div>

        <div className="kitchen-grid">
          {orders.map(
            (o) => {
              const isNew =
                Boolean(
                  newOrders[
                    o.id
                  ]
                );

              const isUpdating =
                updatingOrder ===
                o.id;

              return (
                <article
                  className={
                    isNew
                      ? "ticket ticket-new"
                      : "ticket"
                  }
                  key={o.id}
                  data-testid={`order-ticket-${o.id}`}
                >
                  {isNew && (
                    <div
                      style={{
                        margin:
                          "-18px -18px 16px",
                        padding:
                          "9px 14px",
                        background:
                          "#D03A27",
                        color:
                          "#fff",
                        borderRadius:
                          "14px 14px 0 0",
                        fontSize:
                          "12px",
                        fontWeight:
                          800,
                        letterSpacing:
                          "0.08em",
                        textAlign:
                          "center",
                        animation:
                          "pulse 1.5s infinite"
                      }}
                    >
                      🆕 NEW ORDER
                    </div>
                  )}

                  <div className="ticket-top">
                    <span className="status-pill">
                      {
                        o.status
                      }
                    </span>

                    <small>
                      {
                        o.id
                      }
                    </small>
                  </div>

                  <h3>
                    Table{" "}
                    {
                      o.table_number
                    }
                  </h3>

                  <p className="ticket-customer">
                    {
                      o.customer_name
                    }
                    {" · "}
                    {new Date(
                      o.created_at
                    ).toLocaleTimeString(
                      [],
                      {
                        hour:
                          "2-digit",
                        minute:
                          "2-digit"
                      }
                    )}
                  </p>

                  <div className="ticket-items">
                    {o.items?.map(
                      (
                        x,
                        index
                      ) => (
                        <div
                          key={`${x.item_id}-${index}`}
                        >
                          <span>
                            <b>
                              {
                                x.quantity
                              }
                            </b>{" "}
                            {
                              x.name
                            }
                          </span>

                          <strong>
                            {money(
                              Number(
                                x.price ||
                                  0
                              ) *
                                Number(
                                  x.quantity ||
                                    1
                                )
                            )}
                          </strong>
                        </div>
                      )
                    )}
                  </div>

                  <div
                    style={{
                      display:
                        "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "center",
                      marginTop:
                        "16px",
                      paddingTop:
                        "14px",
                      borderTop:
                        "1px solid rgba(0,0,0,0.08)"
                    }}
                  >
                    <span
                      style={{
                        fontSize:
                          "13px",
                        opacity:
                          0.6
                      }}
                    >
                      Order total
                    </span>

                    <strong
                      style={{
                        fontSize:
                          "18px"
                      }}
                    >
                      {money(
                        o.total
                      )}
                    </strong>
                  </div>

                  <div
                    style={{
                      marginTop:
                        "16px"
                    }}
                  >
                    <p
                      style={{
                        margin:
                          "0 0 9px",
                        fontSize:
                          "11px",
                        fontWeight:
                          800,
                        letterSpacing:
                          "0.08em",
                        textTransform:
                          "uppercase",
                        opacity:
                          0.55
                      }}
                    >
                      Update order status
                    </p>

                    <div
                      style={{
                        display:
                          "grid",
                        gridTemplateColumns:
                          "repeat(2, minmax(0, 1fr))",
                        gap:
                          "8px"
                      }}
                    >
                      {statusButtons.map(
                        (
                          button
                        ) => {
                          const active =
                            o.status ===
                            button.value;

                          return (
                            <button
                              key={
                                button.value
                              }
                              type="button"
                              disabled={
                                isUpdating ||
                                active
                              }
                              onClick={() =>
                                change(
                                  o.id,
                                  button.value
                                )
                              }
                              style={{
                                minHeight:
                                  "42px",
                                borderRadius:
                                  "10px",
                                border:
                                  active
                                    ? "2px solid #111"
                                    : "1px solid #ddd",
                                background:
                                  active
                                    ? "#111"
                                    : "#fff",
                                color:
                                  active
                                    ? "#fff"
                                    : "#111",
                                cursor:
                                  active ||
                                  isUpdating
                                    ? "default"
                                    : "pointer",
                                fontWeight:
                                  700,
                                fontSize:
                                  "12px",
                                opacity:
                                  isUpdating &&
                                  !active
                                    ? 0.5
                                    : 1
                              }}
                            >
                              {isUpdating &&
                              active
                                ? "Updating..."
                                : active
                                ? `✓ ${button.label}`
                                : button.label}
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop:
                        "12px",
                      textAlign:
                        "center",
                      fontSize:
                        "11px",
                      opacity:
                        0.55
                    }}
                  >
                    Current status:{" "}
                    <strong>
                      {
                        o.status
                      }
                    </strong>
                  </div>
                </article>
              );
            }
          )}
        </div>

        {!orders.length && (
          <div
            className="empty-state"
            data-testid="orders-empty-state"
          >
            <ChefHat
              size={30}
            />

            <h3>
              No orders yet.
            </h3>

            <p>
              New verified orders
              will appear here automatically.
            </p>
          </div>
        )}
      </main>
    </>
  );
}

/* =====================================================
   QR MANAGER
===================================================== */

function QRManager() {
  const tables =
    Array.from(
      {
        length: 8
      },
      (_, i) =>
        String(i + 1)
    );

  /* IMPORTANT:
     LIVE FRONTEND URL FOR QR CODES
  */

  const baseURL =
    "https://pixelplate-frontend.onrender.com";

  const [qrImages, setQrImages] =
    useState({});

  useEffect(() => {
    let cancelled =
      false;

    const generateQRCodes =
      async () => {
        const images = {};

        for (
          const table of tables
        ) {
          const qrURL =
            `${baseURL}/?table=${table}`;

          images[table] =
            await QRCode.toDataURL(
              qrURL,
              {
                width:
                  180,
                margin:
                  2,
                errorCorrectionLevel:
                  "H"
              }
            );
        }

        if (!cancelled) {
          setQrImages(
            images
          );
        }
      };

    generateQRCodes()
      .catch(
        console.error
      );

    return () => {
      cancelled =
        true;
    };
  }, []);

  const downloadQR =
    (table) => {
      const image =
        qrImages[
          table
        ];

      if (!image)
        return;

      const link =
        document.createElement(
          "a"
        );

      link.download =
        `PixelPlate-Table-${table}-QR.png`;

      link.href =
        image;

      link.click();
    };

  return (
    <>
      <Header staff />

      <main className="ops-page">
        <div className="ops-head">
          <div>
            <p className="eyebrow">
              QR TABLE MANAGEMENT
            </p>

            <h1>
              Table QR Codes
            </h1>

            <p className="lede">
              Each table has a unique QR code.
              Customers can scan it to open the
              menu with their table automatically
              detected.
            </p>
          </div>
        </div>

        <div className="kitchen-grid">
          {tables.map(
            (table) => {
              const qrURL =
                `${baseURL}/?table=${table}`;

              return (
                <article
                  className="ticket"
                  key={
                    table
                  }
                >
                  <div className="ticket-top">
                    <span className="status-pill">
                      TABLE{" "}
                      {
                        table
                      }
                    </span>

                    <small>
                      QR ORDERING
                    </small>
                  </div>

                  <h3>
                    Table{" "}
                    {
                      table
                    }
                  </h3>

                  <p className="ticket-customer">
                    Scan to open PixelPlate menu
                  </p>

                  <div
                    style={{
                      display:
                        "flex",
                      justifyContent:
                        "center",
                      padding:
                        "20px"
                    }}
                  >
                    {qrImages[
                      table
                    ] ? (
                      <img
                        src={
                          qrImages[
                            table
                          ]
                        }
                        alt={`PixelPlate Table ${table} QR`}
                        width={
                          180
                        }
                        height={
                          180
                        }
                      />
                    ) : (
                      <div>
                        Generating QR...
                      </div>
                    )}
                  </div>

                  <p
                    style={{
                      fontSize:
                        "12px",
                      wordBreak:
                        "break-all",
                      opacity:
                        0.7
                    }}
                  >
                    {
                      qrURL
                    }
                  </p>

                  <button
                    className="primary-button full"
                    onClick={() =>
                      downloadQR(
                        table
                      )
                    }
                    disabled={
                      !qrImages[
                        table
                      ]
                    }
                  >
                    Download Table{" "}
                    {
                      table
                    } QR
                  </button>
                </article>
              );
            }
          )}
        </div>
      </main>
    </>
  );
}

/* =====================================================
   APP ROUTES
===================================================== */

function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route
          path="/"
          element={
            <CustomerMenu />
          }
        />

        <Route
          path="/cart"
          element={
            <Cart />
          }
        />

        <Route
          path="/checkout"
          element={
            <Checkout />
          }
        />

        <Route
          path="/track"
          element={
            <Track />
          }
        />

        <Route
          path="/order/:id"
          element={
            <Track />
          }
        />

        <Route
          path="/login"
          element={
            <Login />
          }
        />

        <Route
          path="/staff"
          element={
            <Staff />
          }
        />

        <Route
          path="/admin"
          element={
            <Staff admin />
          }
        />

        <Route
          path="/admin/qr"
          element={
            <QRManager />
          }
        />

      </Routes>
    </BrowserRouter>
  );
}

export default App;


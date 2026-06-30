(function () {
  const API_BASE = window.MFJ_MERCH_API_BASE || '';
  const state = {
    catalog: [],
    cart: new Map(),
    filter: 'all',
    isCheckingOut: false
  };

  const productGrid = document.getElementById('productGrid');
  const cartLines = document.getElementById('cartLines');
  const cartItemCount = document.getElementById('cartItemCount');
  const cartTotal = document.getElementById('cartTotal');
  const checkoutButton = document.getElementById('checkoutButton');
  const customerEmail = document.getElementById('customerEmail');
  const shopAlert = document.getElementById('shopAlert');
  const totalStock = document.getElementById('totalStock');
  const mobileCartBar = document.getElementById('mobileCartBar');
  const mobileCartCount = document.getElementById('mobileCartCount');
  const mobileCartTotal = document.getElementById('mobileCartTotal');
  const mobileCheckoutButton = document.getElementById('mobileCheckoutButton');
  const checkoutButtonLabel = 'Continue to secure checkout';
  const mobileCheckoutButtonLabel = 'Checkout now';
  const checkoutLoadingLabel = 'Preparing checkout...';

  if (!checkoutButton || !mobileCheckoutButton) {
    throw new Error('Shop checkout controls are missing from the page.');
  }

  function formatGbp(amount) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0
    }).format(amount);
  }

  function showAlert(message, tone) {
    if (!shopAlert) {
      return;
    }
    shopAlert.hidden = false;
    shopAlert.textContent = message;
    shopAlert.dataset.tone = tone || 'info';
  }

  function clearAlert() {
    if (shopAlert) {
      shopAlert.hidden = true;
      shopAlert.textContent = '';
    }
  }

  function setCheckoutButtonLabel(label) {
    const labelNode = checkoutButton.querySelector('.shop-checkout-btn__label');
    labelNode.textContent = label;
  }

  function setMobileCheckoutButtonLabel(label) {
    mobileCheckoutButton.textContent = label;
  }

  function getCustomerEmail() {
    return customerEmail.value.trim();
  }

  function validateCustomerEmail() {
    if (customerEmail.checkValidity()) {
      return true;
    }

    showAlert('Enter your email address before continuing to checkout so we can send your order confirmation.', 'warning');
    customerEmail.scrollIntoView({ behavior: 'smooth', block: 'center' });
    customerEmail.focus();
    customerEmail.reportValidity();
    return false;
  }

  function flattenVariants() {
    return state.catalog.flatMap(function (product) {
      return product.sizes.map(function (size) {
        return {
          id: size.id,
          productId: product.id,
          productName: product.name,
          colour: product.colour,
          category: product.category,
          fit: product.fit,
          description: product.description,
          image: product.image,
          priceGbp: product.priceGbp,
          displayEur: product.displayEur,
          size: size.label,
          available: Number(size.available || 0)
        };
      });
    });
  }

  function findVariant(variantId) {
    return flattenVariants().find(function (variant) {
      return variant.id === variantId;
    });
  }

  function getCartQuantity(variantId) {
    const item = state.cart.get(variantId);
    return item ? item.quantity : 0;
  }

  function getCartTotals() {
    return Array.from(state.cart.values()).reduce(function (totals, item) {
      totals.quantity += item.quantity;
      totals.amount += item.quantity * item.variant.priceGbp;
      return totals;
    }, { quantity: 0, amount: 0 });
  }

  function addToCart(variantId) {
    const variant = findVariant(variantId);
    if (!variant) {
      showAlert('This merch option is no longer available.', 'error');
      return;
    }

    const currentQuantity = getCartQuantity(variantId);
    if (currentQuantity >= variant.available) {
      showAlert('You have already added the available allocation for this size.', 'warning');
      return;
    }

    state.cart.set(variantId, {
      variant: variant,
      quantity: currentQuantity + 1
    });

    if (typeof gtag === 'function') {
      gtag('event', 'add_to_cart', {
        currency: 'GBP',
        value: variant.priceGbp,
        items: [{
          item_id: variant.id,
          item_name: variant.productName,
          item_variant: variant.colour + ' ' + variant.size,
          price: variant.priceGbp,
          quantity: 1
        }]
      });
    }

    clearAlert();
    render();
  }

  function updateCartQuantity(variantId, delta) {
    const item = state.cart.get(variantId);
    if (!item) {
      return;
    }

    const nextQuantity = item.quantity + delta;
    if (nextQuantity <= 0) {
      state.cart.delete(variantId);
    } else if (nextQuantity <= item.variant.available) {
      item.quantity = nextQuantity;
      state.cart.set(variantId, item);
    } else {
      showAlert('That would exceed the currently available quantity.', 'warning');
    }

    render();
  }

  function removeCartLine(variantId) {
    state.cart.delete(variantId);
    render();
  }

  function renderProducts() {
    if (!productGrid) {
      return;
    }

    if (!state.catalog.length) {
      productGrid.innerHTML = '<div class="shop-loading-card"><p>The live merch catalogue is not available yet. Please try again shortly.</p></div>';
      return;
    }

    productGrid.innerHTML = state.catalog.map(function (product) {
      const visible = state.filter === 'all' || product.category === state.filter;
      const sizes = product.sizes.map(function (size) {
        const cartQuantity = getCartQuantity(size.id);
        const remaining = Math.max(Number(size.available || 0) - cartQuantity, 0);
        const disabled = remaining < 1;
        return [
          '<button class="shop-size-btn" type="button" data-variant-id="', size.id, '" ', disabled ? 'disabled' : '', '>',
          size.label,
          '<span>', disabled ? 'Sold out' : remaining + ' left', '</span>',
          '</button>'
        ].join('');
      }).join('');

      return [
        '<article class="shop-product-card" data-category="', product.category, '" ', visible ? '' : 'hidden', '>',
        '<div class="shop-product-card__image"><img src="', product.image, '" alt="', product.name, ' ', product.colour, '"></div>',
        '<div class="shop-product-card__body">',
        '<div class="shop-product-card__meta"><span>', product.colour, '</span><span>', product.fit, '</span></div>',
        '<h3>', product.name, '</h3>',
        '<p>', product.description, '</p>',
        '<div class="shop-price-line">', formatGbp(product.priceGbp), ' / &euro;', product.displayEur, '</div>',
        '<div class="shop-size-grid">', sizes, '</div>',
        '</div>',
        '</article>'
      ].join('');
    }).join('');

    productGrid.querySelectorAll('.shop-size-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        addToCart(button.dataset.variantId);
      });
    });
  }

  function renderCart() {
    const totals = getCartTotals();
    cartItemCount.textContent = String(totals.quantity);
    cartTotal.textContent = formatGbp(totals.amount);
    checkoutButton.disabled = totals.quantity === 0 || state.isCheckingOut;
    setCheckoutButtonLabel(state.isCheckingOut ? checkoutLoadingLabel : checkoutButtonLabel);

    if (mobileCartBar && mobileCartCount && mobileCartTotal) {
      mobileCartBar.hidden = totals.quantity === 0;
      mobileCartCount.textContent = totals.quantity === 1 ? '1 item' : totals.quantity + ' items';
      mobileCartTotal.textContent = formatGbp(totals.amount);
      mobileCheckoutButton.disabled = totals.quantity === 0 || state.isCheckingOut;
      setMobileCheckoutButtonLabel(state.isCheckingOut ? checkoutLoadingLabel : mobileCheckoutButtonLabel);
    }

    if (totals.quantity === 0) {
      cartLines.innerHTML = '<p class="shop-cart__empty">Choose a size to start your order.</p>';
      return;
    }

    cartLines.innerHTML = Array.from(state.cart.values()).map(function (item) {
      return [
        '<div class="shop-cart-line">',
        '<div class="shop-cart-line__top">',
        '<div><h3>', item.variant.productName, '</h3>',
        '<p>', item.variant.colour, ' / ', item.variant.size, ' / ', formatGbp(item.variant.priceGbp), '</p></div>',
        '<strong>', formatGbp(item.variant.priceGbp * item.quantity), '</strong>',
        '</div>',
        '<div class="shop-cart-line__controls">',
        '<button type="button" data-action="decrease" data-variant-id="', item.variant.id, '">-</button>',
        '<strong>', item.quantity, '</strong>',
        '<button type="button" data-action="increase" data-variant-id="', item.variant.id, '">+</button>',
        '<button class="remove-line" type="button" data-action="remove" data-variant-id="', item.variant.id, '">Remove</button>',
        '</div>',
        '</div>'
      ].join('');
    }).join('');

    cartLines.querySelectorAll('button').forEach(function (button) {
      button.addEventListener('click', function () {
        const variantId = button.dataset.variantId;
        if (button.dataset.action === 'increase') {
          updateCartQuantity(variantId, 1);
        } else if (button.dataset.action === 'decrease') {
          updateCartQuantity(variantId, -1);
        } else {
          removeCartLine(variantId);
        }
      });
    });
  }

  function render() {
    renderProducts();
    renderCart();
  }

  async function loadCatalog() {
    if (!API_BASE) {
      showAlert('Merch checkout is not connected yet. Configure the MFJ Dublin Worker URL before go-live.', 'error');
      renderProducts();
      renderCart();
      return;
    }

    try {
      const response = await fetch(API_BASE + '/api/catalog', {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Catalogue service returned ' + response.status);
      }

      const data = await response.json();
      state.catalog = data.catalog || [];
      if (totalStock && data.totals) {
        totalStock.textContent = String(data.totals.initialStock);
      }
      render();
    } catch (error) {
      console.error('Could not load merch catalogue:', error);
      showAlert('The live merch ordering service is not available yet. Please check back shortly.', 'error');
      renderProducts();
      renderCart();
    }
  }

  async function checkout() {
    const totals = getCartTotals();
    if (!totals.quantity || state.isCheckingOut) {
      return;
    }

    if (!validateCustomerEmail()) {
      return;
    }

    state.isCheckingOut = true;
    checkoutButton.disabled = true;
    setCheckoutButtonLabel(checkoutLoadingLabel);
    mobileCheckoutButton.disabled = true;
    setMobileCheckoutButtonLabel(checkoutLoadingLabel);
    clearAlert();

    const items = Array.from(state.cart.values()).map(function (item) {
      return {
        variantId: item.variant.id,
        quantity: item.quantity
      };
    });

    if (typeof gtag === 'function') {
      gtag('event', 'begin_checkout', {
        currency: 'GBP',
        value: totals.amount,
        items: items
      });
    }

    try {
      const response = await fetch(API_BASE + '/api/checkout', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customerEmail: getCustomerEmail(),
          items: items
        })
      });

      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data && data.error ? data.error : 'Checkout could not be started.');
      }

      window.location.href = data.checkoutUrl;
    } catch (error) {
      state.isCheckingOut = false;
      checkoutButton.disabled = false;
      setCheckoutButtonLabel(checkoutButtonLabel);
      mobileCheckoutButton.disabled = false;
      setMobileCheckoutButtonLabel(mobileCheckoutButtonLabel);
      renderCart();
      showAlert(error.message, 'error');
      await loadCatalog();
    }
  }

  async function parseJsonResponse(response) {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  document.querySelectorAll('.filter-btn').forEach(function (button) {
    button.addEventListener('click', function () {
      state.filter = button.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(function (item) {
        item.classList.toggle('is-active', item === button);
      });
      renderProducts();
    });
  });

  checkoutButton.addEventListener('click', checkout);
  mobileCheckoutButton.addEventListener('click', checkout);

  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'cancelled') {
    showAlert('Checkout was cancelled. Your cart is still here if you want to try again.', 'warning');
  }

  loadCatalog();
})();

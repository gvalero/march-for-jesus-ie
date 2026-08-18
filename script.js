const eventDate = new Date(2026, 8, 26, 10, 0, 0).getTime();

function updateCountdown() {
	var daysEl = document.getElementById("days");
	var hoursEl = document.getElementById("hours");
	var minutesEl = document.getElementById("minutes");
	var secondsEl = document.getElementById("seconds");

	if (!daysEl || !hoursEl || !minutesEl || !secondsEl) {
		return;
	}

	var now = new Date().getTime();
	var distance = eventDate - now;

	if (distance <= 0) {
		daysEl.textContent = "00";
		hoursEl.textContent = "00";
		minutesEl.textContent = "00";
		secondsEl.textContent = "00";
		return;
	}

	var days = Math.floor(distance / (1000 * 60 * 60 * 24));
	var hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
	var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
	var seconds = Math.floor((distance % (1000 * 60)) / 1000);

	daysEl.textContent = String(days).padStart(2, "0");
	hoursEl.textContent = String(hours).padStart(2, "0");
	minutesEl.textContent = String(minutes).padStart(2, "0");
	secondsEl.textContent = String(seconds).padStart(2, "0");
}

document.addEventListener("DOMContentLoaded", function () {
	document.querySelectorAll("img").forEach(function (img, index) {
		if (!img.hasAttribute("loading")) {
			img.setAttribute("loading", index < 2 ? "eager" : "lazy");
		}
		if (!img.hasAttribute("decoding")) {
			img.setAttribute("decoding", "async");
		}
	});

	const menuToggle = document.querySelector(".menu-toggle");
	const menu = document.querySelector(".menu");
	const nav = document.querySelector(".nav");
	const backToTop = document.querySelector(".back-to-top");
	const submenuParents = document.querySelectorAll(".menu .has-submenu > a");

	if (nav || backToTop) {
		window.addEventListener("scroll", function () {
			if (nav && window.scrollY > 50) {
				nav.classList.add("scrolled");
			} else if (nav) {
				nav.classList.remove("scrolled");
			}

			if (backToTop && window.scrollY > 250) {
				backToTop.classList.add("show");
			} else if (backToTop) {
				backToTop.classList.remove("show");
			}
		});
	}

	if (menuToggle && menu) {
		submenuParents.forEach(function (toggle) {
			toggle.addEventListener("click", function (event) {
				if (window.innerWidth > 900) {
					return;
				}
				event.preventDefault();
				const parent = toggle.parentElement;
				if (!parent) {
					return;
				}
				document.querySelectorAll(".menu .has-submenu.open").forEach(function (item) {
					if (item !== parent) {
						item.classList.remove("open");
					}
				});
				parent.classList.toggle("open");
			});
		});

		menuToggle.addEventListener("click", function () {
			const isOpen = menu.classList.toggle("is-open");
			menuToggle.classList.toggle("is-active", isOpen);
			menuToggle.setAttribute("aria-expanded", String(isOpen));
		});

		menu.querySelectorAll("a").forEach(function (link) {
			link.addEventListener("click", function () {
				if (window.innerWidth <= 900 && link.parentElement && link.parentElement.classList.contains("has-submenu")) {
					return;
				}
				if (window.innerWidth <= 900) {
					menu.classList.remove("is-open");
					menuToggle.classList.remove("is-active");
					menuToggle.setAttribute("aria-expanded", "false");
					document.querySelectorAll(".menu .has-submenu.open").forEach(function (item) {
						item.classList.remove("open");
					});
				}
			});
		});

		window.addEventListener("resize", function () {
			if (window.innerWidth > 900) {
				menu.classList.remove("is-open");
				menuToggle.classList.remove("is-active");
				menuToggle.setAttribute("aria-expanded", "false");
				document.querySelectorAll(".menu .has-submenu.open").forEach(function (item) {
					item.classList.remove("open");
				});
			}
		});
	}

	updateCountdown();
	setInterval(updateCountdown, 1000);

	const watchStats = document.querySelector(".watch-stats");
	let countersStarted = false;

	function startCounters() {
		if (countersStarted) {
			return;
		}
		countersStarted = true;

		const counters = document.querySelectorAll(".counter");
		counters.forEach(function (counter) {
			const target = Number(counter.dataset.target) || 0;
			let count = 0;

			function update() {
				count += target / 150;
				if (count < target) {
					counter.textContent = String(Math.floor(count));
					requestAnimationFrame(update);
				} else {
					counter.textContent = target.toLocaleString() + "+";
				}
			}

			update();
		});
	}

	if (watchStats && typeof IntersectionObserver !== "undefined") {
		const counterObserver = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					startCounters();
					counterObserver.disconnect();
				}
			});
		}, { threshold: 0.2 });

		counterObserver.observe(watchStats);

		setTimeout(function () {
			if (!countersStarted) {
				startCounters();
			}
		}, 1200);
	} else if (watchStats) {
		startCounters();
	}

	const zoomTriggers = document.querySelectorAll("[data-zoom-image]");
	if (zoomTriggers.length) {
		const modal = document.createElement("div");
		modal.className = "image-zoom-modal";
		modal.setAttribute("aria-hidden", "true");

		const zoomedImage = document.createElement("img");
		zoomedImage.alt = "";
		modal.appendChild(zoomedImage);

		document.body.appendChild(modal);

		function closeZoomModal() {
			modal.classList.remove("is-open");
			modal.setAttribute("aria-hidden", "true");
		}

		zoomTriggers.forEach(function (trigger) {
			trigger.addEventListener("click", function () {
				zoomedImage.src = trigger.getAttribute("data-zoom-image") || "";
				zoomedImage.alt = trigger.querySelector("img") ? trigger.querySelector("img").alt : "";
				modal.classList.add("is-open");
				modal.setAttribute("aria-hidden", "false");
			});
		});

		modal.addEventListener("click", function (event) {
			if (event.target === modal) {
				closeZoomModal();
			}
		});

		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape" && modal.classList.contains("is-open")) {
				closeZoomModal();
			}
		});
	}

	if (typeof IntersectionObserver !== "undefined") {
		var sectionObserver = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					entry.target.classList.add("show");
				}
			});
		});

		document.querySelectorAll(".animate").forEach(function (el) {
			sectionObserver.observe(el);
		});
	}

	const scheduleItems = document.querySelectorAll(".schedule-grid > div");
	if (scheduleItems.length) {
		scheduleItems.forEach(function (item) {
			item.setAttribute("tabindex", "0");
			item.setAttribute("role", "button");
			item.setAttribute("aria-pressed", "false");

			function activateItem() {
				scheduleItems.forEach(function (other) {
					other.classList.remove("is-active");
					other.setAttribute("aria-pressed", "false");
				});
				item.classList.add("is-active");
				item.setAttribute("aria-pressed", "true");
			}

			item.addEventListener("click", activateItem);
			item.addEventListener("keydown", function (event) {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					activateItem();
				}
			});
		});
	}
});

// --- Gallery Show More/Less Toggle ---
var galleryToggle = document.getElementById('galleryToggle');
var galleryGrid = document.querySelector('.gallery-grid');
if (galleryToggle && galleryGrid) {
    galleryToggle.addEventListener('click', function() {
        var expanded = galleryGrid.classList.toggle('gallery-expanded');
        galleryToggle.textContent = expanded ? 'Show Less' : 'Show More';
    });
}

// --- Marketing tracking helpers (consent-gated via consent.js / MFJConsent) ---
function mfjEventId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'e-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
function mfjGetCookie(name) {
    var m = document.cookie.match('(?:^|; )' + name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : '';
}
function mfjMarketingConsent() {
    return !!(window.MFJConsent && window.MFJConsent.hasMarketingConsent());
}

// --- Email Signup Form (MailerLite via Cloudflare Worker) ---
var emailForm = document.getElementById('emailSignupForm');
if (emailForm) {
    emailForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var btn = emailForm.querySelector('button[type="submit"]');
        var emailSignupSuccess = document.getElementById('emailSignupSuccess');
        var emailSignupNote = document.getElementById('emailSignupNote');
        var originalText = btn.textContent;
        var succeeded = false;
        btn.textContent = 'Sending...';
        btn.disabled = true;

        var formData = {
            email: emailForm.querySelector('[name="email"]').value,
            name: emailForm.querySelector('[name="name"]').value,
            last_name: emailForm.querySelector('[name="last_name"]').value,
            phone: (emailForm.querySelector('[name="phone"]') || {}).value || '',
            county: (emailForm.querySelector('[name="county"]') || {}).value || '',
            church: (emailForm.querySelector('[name="church"]') || {}).value || '',
            attended_before: (emailForm.querySelector('[name="attended_before"]:checked') || {}).value || '',
            marketing_consent: emailForm.querySelector('[name="consent"]').checked ? 'Yes' : 'No',
            form_type: 'website_signup'
        };

        // One shared ID so the browser TikTok event and the server-side Events
        // API event (sent by the Worker) can be deduplicated by TikTok.
        var eventId = mfjEventId();
        formData.eventId = eventId;
        formData.ttclid = new URLSearchParams(window.location.search).get('ttclid') || '';
        formData.ttp = mfjGetCookie('_ttp');
        formData.pageUrl = window.location.href;
        formData.marketing_tracking_consent = mfjMarketingConsent();

        fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        }).then(function(response) {
            if (response.ok) {
                if (typeof gtag === 'function') {
                    gtag('event', 'form_submission', {
                        form_id: 'email_signup',
                        form_name: 'Email Signup',
                        form_destination: 'mailerlite'
                    });
                    // GA4 recommended lead event — Updates (sign-up) form only.
                    gtag('event', 'generate_lead', {
                        form_id: 'updates_form',
                        form_name: 'March for Jesus Ireland - Sign Up for Updates',
                        form_location: 'homepage',
                        lead_type: 'event_updates'
                    });
                }
                // Meta + TikTok conversions — fire only with marketing consent.
                if (mfjMarketingConsent()) {
                    if (typeof window.fbq === 'function') {
                        window.fbq('track', 'Lead');
                    }
                    if (window.ttq && typeof window.ttq.track === 'function') {
                        window.ttq.track('SubmitForm', {}, { event_id: eventId });
                    }
                }
                emailForm.reset();
                emailForm.hidden = true;
                emailSignupNote.hidden = true;
                emailSignupSuccess.hidden = false;
                emailSignupSuccess.focus();
                succeeded = true;
            } else {
                btn.textContent = 'Error — try again';
            }
        }).catch(function() {
            btn.textContent = 'Error — try again';
        }).finally(function() {
            if (!succeeded) {
                setTimeout(function() {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 3000);
            }
        });
    });
}

// --- Contact Form (MailerLite via Cloudflare Worker) ---
var contactForm = document.getElementById('contactForm');
if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var btn = contactForm.querySelector('button[type="submit"]');
        var originalText = btn.textContent;
        btn.textContent = 'Sending...';
        btn.disabled = true;

        var formData = {
            email: document.getElementById('contactEmail').value,
            name: document.getElementById('firstName').value,
            last_name: document.getElementById('lastName').value,
            phone: (document.getElementById('phone') || {}).value || '',
            form_type: 'contact_form'
        };

        fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        }).then(function(response) {
            if (response.ok) {
                if (typeof gtag === 'function') {
                    gtag('event', 'form_submission', {
                        form_id: 'contact_form',
                        form_name: 'Contact Form',
                        form_destination: 'mailerlite'
                    });
                    // Contact form is NOT a lead — distinct GA4 signal only.
                    gtag('event', 'contact_request', {
                        form_id: 'contact_form',
                        form_name: 'Get in Touch',
                        form_location: 'homepage'
                    });
                }
                btn.textContent = 'Sent!';
                contactForm.reset();
            } else {
                btn.textContent = 'Error — try again';
            }
        }).catch(function() {
            btn.textContent = 'Error — try again';
        }).finally(function() {
            setTimeout(function() {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 3000);
        });
    });
}

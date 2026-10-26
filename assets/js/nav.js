/* Shared mobile navigation for the public pages.
   Relative script URL so it still loads under GitHub Pages. */
(function () {
    var DESKTOP = window.matchMedia("(min-width: 861px)");
    var buttons = document.querySelectorAll(".mobile-menu");

    if (!buttons.length) return;

    function closestHeader(button) {
        return button.closest(".site-header") || document.body;
    }

    function findNav(header) {
        return header.querySelector(".main-nav");
    }

    buttons.forEach(function (button, index) {
        var header = closestHeader(button);
        var nav = findNav(header);
        if (!nav) return;

        if (!nav.id) nav.id = index === 0 ? "site-nav" : "site-nav-" + (index + 1);
        button.setAttribute("aria-controls", nav.id);
        button.setAttribute("aria-expanded", "false");
        if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", "Open menu");
        if (!button.hasAttribute("type")) button.setAttribute("type", "button");

        function isOpen() {
            return header.classList.contains("is-open");
        }

        function setOpen(open) {
            header.classList.toggle("is-open", open);
            button.setAttribute("aria-expanded", open ? "true" : "false");
            button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        }

        button.addEventListener("click", function (event) {
            event.stopPropagation();
            setOpen(!isOpen());
        });

        nav.addEventListener("click", function (event) {
            if (event.target.closest("a")) setOpen(false);
        });

        document.addEventListener("click", function (event) {
            if (!isOpen()) return;
            if (header.contains(event.target)) return;
            setOpen(false);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || !isOpen()) return;
            setOpen(false);
            button.focus();
        });

        function closeOnDesktop() {
            if (DESKTOP.matches) setOpen(false);
        }

        if (typeof DESKTOP.addEventListener === "function") {
            DESKTOP.addEventListener("change", closeOnDesktop);
        } else if (typeof DESKTOP.addListener === "function") {
            DESKTOP.addListener(closeOnDesktop);
        }
    });
})();

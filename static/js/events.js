document.addEventListener("DOMContentLoaded", () => {
    // Search elements
    const searchInput = document.getElementById("event-search");
    // Filter buttons
    const filterButtons = document.querySelectorAll(".filter-btn");
    // Cards
    const cards = document.querySelectorAll(".event-card");
    // Columns (to hide column header if no cards match in a column)
    const publicColumn = document.getElementById("public-events-col");
    const reportedColumn = document.getElementById("reported-incidents-col");

    let currentFilter = "all";
    let searchQuery = "";

    // Add event listeners for filter buttons
    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            filterButtons.forEach(btn => btn.classList.remove("active"));
            button.classList.add("active");
            currentFilter = button.getAttribute("data-filter");
            applyFilters();
        });
    });

    // Add event listener for search input
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            applyFilters();
        });
    }

    function applyFilters() {
        let publicVisibleCount = 0;
        let reportedVisibleCount = 0;

        cards.forEach(card => {
            const isPublic = card.classList.contains("public-event-type");
            const isReport = card.classList.contains("report-type");
            const priority = card.getAttribute("data-priority");

            // 1. Check Category Filter
            let matchesCategory = false;
            if (currentFilter === "all") {
                matchesCategory = true;
            } else if (currentFilter === "high" && priority === "high") {
                matchesCategory = true;
            } else if (currentFilter === "public" && isPublic) {
                matchesCategory = true;
            } else if (currentFilter === "reports" && isReport) {
                matchesCategory = true;
            }

            // 2. Check Search Query
            let matchesSearch = false;
            if (searchQuery === "") {
                matchesSearch = true;
            } else {
                const title = card.querySelector(".card-title")?.textContent.toLowerCase() || "";
                const desc = card.querySelector(".card-desc")?.textContent.toLowerCase() || "";
                
                // Read text of meta items (location, dates, crowd, etc)
                const metaTexts = Array.from(card.querySelectorAll(".meta-item span"))
                    .map(el => el.textContent.toLowerCase())
                    .join(" ");

                const categoryTag = card.querySelector(".category-tag")?.textContent.toLowerCase() || "";
                const statusTag = card.querySelector(".status-tag")?.textContent.toLowerCase() || "";

                if (
                    title.includes(searchQuery) ||
                    desc.includes(searchQuery) ||
                    metaTexts.includes(searchQuery) ||
                    categoryTag.includes(searchQuery) ||
                    statusTag.includes(searchQuery)
                ) {
                    matchesSearch = true;
                }
            }

            // 3. Apply display style
            if (matchesCategory && matchesSearch) {
                card.style.display = "block";
                if (isPublic) publicVisibleCount++;
                if (isReport) reportedVisibleCount++;
            } else {
                card.style.display = "none";
            }
        });

        // Toggle column display if no cards match (optional, for clean UI)
        if (publicColumn) {
            publicColumn.style.display = (currentFilter === "reports" || publicVisibleCount === 0) && currentFilter !== "all" && currentFilter !== "high" ? "none" : "flex";
        }
        if (reportedColumn) {
            reportedColumn.style.display = (currentFilter === "public" || reportedVisibleCount === 0) && currentFilter !== "all" && currentFilter !== "high" ? "none" : "flex";
        }
    }

    // Modal Interaction
    const addEventBtn = document.querySelector(".add-event-btn");
    const modalBackdrop = document.getElementById("add-event-modal");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const btnCancelModal = document.getElementById("btn-cancel-modal");
    const newEventForm = document.getElementById("new-event-form");

    if (addEventBtn && modalBackdrop) {
        addEventBtn.addEventListener("click", () => {
            modalBackdrop.classList.add("active");
        });
    }

    function closeModal() {
        if (modalBackdrop) {
            modalBackdrop.classList.remove("active");
            if (newEventForm) newEventForm.reset();
        }
    }

    if (btnCloseModal) {
        btnCloseModal.addEventListener("click", closeModal);
    }

    if (btnCancelModal) {
        btnCancelModal.addEventListener("click", closeModal);
    }

    if (modalBackdrop) {
        modalBackdrop.addEventListener("click", (e) => {
            if (e.target === modalBackdrop) {
                closeModal();
            }
        });
    }

    if (newEventForm) {
        newEventForm.addEventListener("submit", (e) => {
            e.preventDefault();
            // Just close the modal statically as requested (no backend add needed)
            closeModal();
        });
    }
});

/* ==========================================================================
   TRAFFIC TWIN BENGALURU — MAIN SCRIPT
   ========================================================================= */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Navbar Shrink Handler
    const nav = document.getElementById('main-nav');
    if (nav) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                nav.classList.add('shrunk');
            } else {
                nav.classList.remove('shrunk');
            }
        });
    }

    // 2. Scroll Reveal Animations
    const reveals = document.querySelectorAll('.reveal');
    if (reveals.length > 0) {
        const observerOptions = {
            root: null,
            threshold: 0.15,
            rootMargin: '0px'
        };

        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    observer.unobserve(entry.target); // Trigger once
                }
            });
        }, observerOptions);

        reveals.forEach(reveal => {
            revealObserver.observe(reveal);
        });
    }

    // 3. Animated Counters
    const counters = document.querySelectorAll('.counter');
    if (counters.length > 0) {
        const counterOptions = {
            root: null,
            threshold: 0.5
        };

        const counterObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const counter = entry.target;
                    const target = parseInt(counter.getAttribute('data-target'), 10);
                    const duration = 2000; // ms
                    const startTime = performance.now();
                    const startVal = 0;

                    function updateCount(currentTime) {
                        const elapsed = currentTime - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        
                        // Ease out quad
                        const easeProgress = progress * (2 - progress);
                        const currentVal = Math.floor(startVal + easeProgress * (target - startVal));
                        
                        counter.innerText = currentVal.toLocaleString() + (counter.getAttribute('data-suffix') || '');

                        if (progress < 1) {
                            requestAnimationFrame(updateCount);
                        } else {
                            counter.innerText = target.toLocaleString() + (counter.getAttribute('data-suffix') || '');
                        }
                    }

                    requestAnimationFrame(updateCount);
                    observer.unobserve(counter); // Trigger once
                }
            });
        }, counterOptions);

        counters.forEach(counter => {
            counterObserver.observe(counter);
        });
    }

    // 4. Interactive Hero Canvas: Moving Particles & Nodes
    const canvas = document.getElementById('hero-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let width = canvas.width = canvas.offsetWidth;
        let height = canvas.height = canvas.offsetHeight;

        window.addEventListener('resize', () => {
            if (canvas.offsetWidth !== width || canvas.offsetHeight !== height) {
                width = canvas.width = canvas.offsetWidth;
                height = canvas.height = canvas.offsetHeight;
                initNetwork();
            }
        });

        // Nodes Configuration (Bengaluru road junctions representation)
        let nodes = [];
        let edges = [];
        let particles = [];

        function initNetwork() {
            nodes = [];
            edges = [];
            particles = [];

            // Define 16 structural nodes across coordinates
            const cols = 4;
            const rows = 4;
            const xStep = width / (cols + 1);
            const yStep = height / (rows + 1);

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Introduce slight random offset to simulate organic city growth
                    const offsetX = (Math.random() - 0.5) * xStep * 0.4;
                    const offsetY = (Math.random() - 0.5) * yStep * 0.4;
                    nodes.push({
                        id: r * cols + c,
                        x: xStep * (c + 1) + offsetX,
                        y: yStep * (r + 1) + offsetY,
                        radius: 5 + Math.random() * 4,
                        pulse: Math.random() * Math.PI
                    });
                }
            }

            // Create connections (edges)
            for (let i = 0; i < nodes.length; i++) {
                const nodeA = nodes[i];
                // Connect to next column neighbour
                if ((i + 1) % cols !== 0) {
                    edges.push({ from: nodeA, to: nodes[i + 1] });
                }
                // Connect to next row neighbour
                if (i + cols < nodes.length) {
                    edges.push({ from: nodeA, to: nodes[i + cols] });
                }
                // Connect some diagonals for junction complexity
                if (Math.random() > 0.75 && (i + cols + 1) < nodes.length && (i + 1) % cols !== 0) {
                    edges.push({ from: nodeA, to: nodes[i + cols + 1] });
                }
            }

            // Populate active particles (vehicles flowing)
            const numParticles = 45;
            for (let p = 0; p < numParticles; p++) {
                const randomEdge = edges[Math.floor(Math.random() * edges.length)];
                particles.push({
                    edge: randomEdge,
                    progress: Math.random(), // 0 to 1
                    speed: 0.001 + Math.random() * 0.0025,
                    size: 3 + Math.random() * 2
                });
            }
        }

        function drawNetwork() {
            ctx.clearRect(0, 0, width, height);

            // Draw Roads (Edges)
            ctx.strokeStyle = 'rgba(45, 42, 38, 0.05)';
            ctx.lineWidth = 2.5;
            edges.forEach(edge => {
                ctx.beginPath();
                ctx.moveTo(edge.from.x, edge.from.y);
                ctx.lineTo(edge.to.x, edge.to.y);
                ctx.stroke();
            });

            // Draw Junctions (Nodes)
            nodes.forEach(node => {
                node.pulse += 0.015;
                const pulseScale = 1 + Math.sin(node.pulse) * 0.25;

                // Deep green junction color
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius * pulseScale, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(65, 100, 74, 0.2)';
                ctx.fill();

                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius * 0.6, 0, Math.PI * 2);
                ctx.fillStyle = '#41644A';
                ctx.fill();
            });

            // Draw & Update Particles
            particles.forEach(p => {
                p.progress += p.speed;
                if (p.progress >= 1.0) {
                    // Reset to a new random edge to maintain traffic flow loop
                    p.progress = 0;
                    p.edge = edges[Math.floor(Math.random() * edges.length)];
                    p.speed = 0.001 + Math.random() * 0.0025;
                }

                // Interpolate particle coordinates
                const startX = p.edge.from.x;
                const startY = p.edge.from.y;
                const endX = p.edge.to.x;
                const endY = p.edge.to.y;

                const curX = startX + (endX - startX) * p.progress;
                const curY = startY + (endY - startY) * p.progress;

                // Saffron orange particle color
                ctx.beginPath();
                ctx.arc(curX, curY, p.size, 0, Math.PI * 2);
                ctx.fillStyle = '#E86A33';
                ctx.shadowColor = '#E86A33';
                ctx.shadowBlur = 4;
                ctx.fill();
                ctx.shadowBlur = 0; // Reset
            });

            requestAnimationFrame(drawNetwork);
        }

        initNetwork();
        drawNetwork();
    }
});

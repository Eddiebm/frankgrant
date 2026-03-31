# FrankGrant Marketing Website

Static HTML/CSS/JS marketing site for FrankGrant — NIH grant writing by experts, peer-reviewed before you submit.

## File Structure

```
website/
├── index.html              # Home page
├── pricing.html            # Pricing tiers + ROI calculator
├── newsletter.html         # The Payline newsletter page
├── faq.html                # FAQ with accordion + sidebar nav
├── hire.html               # Client intake form (Done For You)
├── blog/
│   ├── index.html          # Blog listing (6 articles)
│   └── why-your-grant-got-triaged.html   # Full article
├── images/
│   ├── logo.svg            # Full logo (200x40)
│   └── favicon.svg         # Favicon (32x32)
├── styles/
│   ├── global.css          # Design system, tokens, utilities
│   ├── nav.css             # Navigation + mobile overlay
│   ├── footer.css          # Footer
│   ├── home.css            # Hero, steps, simulation, testimonials
│   ├── pricing.css         # Pricing tiers, calculator, SaaS
│   ├── newsletter.css      # Newsletter page
│   ├── blog.css            # Blog listing + article layout
│   ├── faq.css             # FAQ accordion + sidebar
│   └── hire.css            # Intake form + hero
└── scripts/
    ├── theme.js            # Dark/light mode toggle
    ├── nav.js              # Mobile hamburger + active links
    ├── animations.js       # Scroll animations, FAQ accordion, simulation
    └── calculator.js       # ROI calculator (pricing page)
```

## How to Add a New Blog Post

1. Copy an existing article file as your template:
   ```
   cp website/blog/why-your-grant-got-triaged.html website/blog/your-new-slug.html
   ```

2. Update in the new file:
   - `<title>` tag with your article title
   - `<meta name="description">` tag
   - `.article-category` text
   - `.article-title` heading
   - `.article-date` and `.article-reading-time`
   - All content inside `.article-body`
   - The `.article-hero-image` gradient and heading
   - Related articles links in the sidebar

3. Add a card to `website/blog/index.html` in the `.blog-grid` section — follow the existing card pattern.

4. Deploy (see deployment section below).

## How to Connect a Real Newsletter Service

The newsletter forms throughout the site currently use a simple JavaScript success state. To connect to a real service (Beehiiv, Convertkit, Mailchimp, etc.):

1. Open `website/scripts/animations.js` (or the inline script in each page)
2. Replace the `form.addEventListener('submit', ...)` handlers with a `fetch()` POST to your newsletter service's API endpoint
3. Most services provide an embed code or API endpoint — replace the mock success state with a real API call

Example using Beehiiv:
```javascript
form.addEventListener('submit', function(e) {
  e.preventDefault();
  var email = form.querySelector('[type="email"]').value;
  fetch('https://api.beehiiv.com/v2/publications/YOUR_PUB_ID/subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY'
    },
    body: JSON.stringify({ email: email })
  }).then(function() {
    form.innerHTML = '<p>You\'re subscribed!</p>';
  });
});
```

## How to Add Real Testimonials

Testimonials are in `website/index.html` in the `.grid-3` section under the "What Researchers Say" heading.

Each testimonial follows this pattern:
```html
<div class="testimonial-card animate-on-scroll">
  <p class="testimonial-quote">"Your quote here."</p>
  <div class="testimonial-author">
    <div class="testimonial-avatar">A</div>   <!-- First initial -->
    <div>
      <div class="testimonial-name">First Name L.</div>
      <div class="testimonial-institution">Title · Institution</div>
    </div>
  </div>
</div>
```

Use first name + last initial only to protect researcher privacy.

## How to Update Pricing

Pricing appears in two places:

1. **`website/pricing.html`** — The three tier cards. Update the `.tier-price` and `.tier-price-note` values in each `.tier-card`.

2. **`website/scripts/calculator.js`** — The `upfrontFees` and `consultantCosts` objects at the top of the file control what the ROI calculator displays.

3. **`website/index.html`** — The pricing preview section (`.pricing-cards`) has simplified cards with hardcoded prices.

4. **`website/hire.html`** — The mechanism dropdown and the inline `mechanismFees` JavaScript object control the fee display on the intake form.

## Deployment

The site is a static HTML website. Deploy with Wrangler Pages:

```bash
cd /path/to/frankgrant
npx wrangler pages deploy website --project-name frankgrant-marketing --commit-dirty=true
```

Or deploy to any static hosting service (Vercel, Netlify, GitHub Pages):

```bash
# Vercel
npx vercel website --prod

# Netlify
npx netlify deploy --dir website --prod
```

## Design System Notes

- Brand color (primary teal): `#0d9488`
- Dark theme is the default (`data-theme="dark"` on `<html>`)
- Theme is toggled via `scripts/theme.js` and persisted to `localStorage`
- All CSS custom properties are in `styles/global.css`
- Scroll animations use `IntersectionObserver` with `.animate-on-scroll` class
- The FAQ accordion works for both `.faq-question` and `.pricing-faq-question` patterns
- Blog subdirectory pages use `../` relative paths for all assets

## Intake Form Endpoint

The client intake form in `hire.html` POSTs to:
```
https://frankgrant-worker.eddie-781pagesdev.workers.dev/api/intake/direct
```

Update the fetch URL in the inline `<script>` at the bottom of `hire.html` if the worker endpoint changes.

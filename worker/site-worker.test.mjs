import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import siteWorker from './site-worker.js';

const CHURCH_REGISTRATION_URL =
  'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=f6y-zCtfL06W-3G7pTXM82CVYKlavfFOlvnuDnu6lV1UMjlCWkJIRkdJUTM5MExVVDI5RldZQ0w2Vi4u';

test('redirects the church registration short URL to Microsoft Forms', async () => {
  const env = {
    ASSETS: {
      fetch() {
        throw new Error('Static assets should not handle the redirect');
      }
    }
  };

  const response = await siteWorker.fetch(
    new Request('https://marchforjesus.ie/churchregistration'),
    env,
    {}
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), CHURCH_REGISTRATION_URL);
});

test('continues to serve other paths from the static assets binding', async () => {
  const assetResponse = new Response('home page');
  const env = {
    ASSETS: {
      fetch(request) {
        assert.equal(new URL(request.url).pathname, '/');
        return assetResponse;
      }
    }
  };

  const response = await siteWorker.fetch(
    new Request('https://marchforjesus.ie/'),
    env,
    {}
  );

  assert.equal(response, assetResponse);
});

test('shows three involvement options with church registration replacing attendee signup', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const signupSection = html.match(/<section id="signup"[\s\S]*?<\/section>/)?.[0];

  assert.match(html, /<li class="dropdown has-submenu">\s*<a href="#signup">Get Involved<\/a>/);
  assert.match(html, /<a href="#signup" class="hero-cta">Get Involved<\/a>/);
  assert.doesNotMatch(html, /<a href="#signup" class="hero-cta">Sign Up Now<\/a>/);
  assert.doesNotMatch(html, /G6m8cG5FMAm8tozPNGQFvW/);
  assert.ok(signupSection);
  assert.equal((signupSection.match(/class="signup-step"/g) || []).length, 3);
  assert.match(signupSection, /Three ways to be part of March for Jesus Dublin 2026/);
  assert.match(
    signupSection,
    /href="https:\/\/forms\.office\.com\/Pages\/ResponsePage\.aspx\?id=f6y-zCtfL06W-3G7pTXM82CVYKlavfFOlvnuDnu6lV1UNkU1UzAwNUxKTlIxUUpRMTUzQURNMUFZQy4u"/
  );
  assert.match(signupSection, /href="https:\/\/chat\.whatsapp\.com\/DcYqf41xuhyDyIp6khczlG"/);
  assert.match(signupSection, /href="\/churchregistration"/);
  assert.match(signupSection, /Churches – Join Us!/);
  assert.doesNotMatch(signupSection, /Sign Up to Attend/);
});

test('shows a prominent confirmation state after updates signup succeeds', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    html,
    /id="emailSignupSuccess" class="updates-success" role="status" aria-live="polite" tabindex="-1" hidden/
  );
  assert.match(html, /<h3>Thank you for signing up!<\/h3>/);
  assert.match(script, /emailForm\.hidden = true;/);
  assert.match(script, /emailSignupSuccess\.hidden = false;/);
  assert.match(script, /emailSignupSuccess\.focus\(\);/);
  assert.match(styles, /\.contact-signup-section \.updates-success/);
  assert.match(styles, /\.contact-signup-section \.updates-form\[hidden\]/);
  assert.match(styles, /\.updates-success\[hidden\]/);
});

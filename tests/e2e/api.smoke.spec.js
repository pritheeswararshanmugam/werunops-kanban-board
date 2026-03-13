const { test, expect } = require('@playwright/test');

test('backend auth and health smoke', async ({ request }) => {
  const health = await request.get('http://127.0.0.1:9000/api/v1/health');
  expect(health.ok()).toBeTruthy();

  const login = await request.post('http://127.0.0.1:9000/api/v1/auth/login', {
    data: {
      username: 'Eshwar',
      password: '110495',
    },
  });

  expect(login.ok()).toBeTruthy();
  const payload = await login.json();
  expect(payload?.data?.accessToken).toBeTruthy();
});

// All Supabase/API responses in this suite are intercepted fixtures, never a claim
// that hosted authentication or the browser-to-real-API flow has been verified.
import { test, expect, type Page } from '@playwright/test';
const userId='f03eb9af-73c3-4a1b-abda-753c169265b2';
const machine={id:'machine-fixture',code:'WH-C',name:'Blown-film line',manufacturer:'Windmöller & Hölscher',model:null,operationalStatus:'NOT_MONITORED',department:null,location:null,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
const me={userId,membershipId:'membership-fixture',displayName:'Fixture operator',orgId:'fixture-org',organization:'Supreme Industries',role:'OPERATOR'};
const b64=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.browser-test-signature`;
async function setup(page:Page){
 await page.route('http://127.0.0.1:54399/auth/v1/**',async route=>{
  if(route.request().url().includes('/token'))await route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,user:{id:userId,aud:'authenticated',role:'authenticated',email:'fixture@example.test',app_metadata:{},user_metadata:{},created_at:'2026-09-01T00:00:00Z'}}});
  else await route.fulfill({json:{id:userId}});
 });
 await page.route('http://127.0.0.1:4400/api/**',async route=>{
  expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
  const path=new URL(route.request().url()).pathname;
  await route.fulfill({json:path.endsWith('/me')?me:path.endsWith('/WH-C')?machine:{items:[machine],nextCursor:null}});
 });
}
async function signIn(page:Page){await page.goto('/login');await page.getByLabel('Work email').fill('fixture@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/machines$/);}
test('unauthenticated access returns to sign in',async({page})=>{await page.goto('/machines/WH-C');await expect(page).toHaveURL(/\/login$/);await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();});
test('login, machine registry and WH-C page use the API contract and fit the viewport',async({page})=>{
 await setup(page);await signIn(page);await page.getByRole('link',{name:/WH-C.*Blown-film line/}).click();
 await expect(page.getByRole('heading',{name:/WH-C.*Blown-film line/})).toBeVisible();await expect(page.getByText('Not yet confirmed',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Live status unavailable')).toBeVisible();await expect(page.getByText('Your data story starts with an import')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/machine-${test.info().project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'Sign out'}).click();await expect(page).toHaveURL(/\/login$/);
});
test('loading and empty states explain machine access',async({page})=>{
 await setup(page);let release:()=>void=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/machines',async route=>{await wait;await route.fulfill({json:{items:[],nextCursor:null}});});
 await signIn(page);await expect(page.getByRole('status')).toContainText('Loading your machine records');release();await expect(page.getByRole('heading',{name:'No machines assigned yet'})).toBeVisible();
});
test('API failure exposes a useful retry and succeeds after recovery',async({page})=>{
 await setup(page);let failed=true;
 await page.route('**/api/machines',async route=>{if(failed)await route.fulfill({status:503,json:{message:'A required service is unavailable.'}});else await route.fulfill({json:{items:[machine],nextCursor:null}});});
 await signIn(page);await expect(page.getByRole('alert').filter({hasText:'A required service is unavailable'})).toContainText('A required service is unavailable');failed=false;await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('link',{name:/WH-C.*Blown-film line/})).toBeVisible();
});
test('expired API authentication clears the session and prompts sign in',async({page})=>{
 await setup(page);await page.route('**/api/me',route=>route.fulfill({status:401,json:{message:'Session expired.'}}));
 await page.goto('/login');await page.getByLabel('Work email').fill('fixture@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page).toHaveURL(/reason=expired/);await expect(page.getByRole('alert').filter({hasText:'Your session expired'})).toContainText('Your session expired');
});
test('invalid login is actionable',async({page})=>{
 await setup(page);await page.route('**/auth/v1/token?*',route=>route.fulfill({status:400,json:{error:'invalid_grant',error_description:'Invalid login credentials'}}));
 await page.goto('/login');await page.getByLabel('Work email').fill('fixture@example.test');await page.getByLabel('Password',{exact:true}).fill('wrong-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'email or password was not accepted'})).toContainText('email or password was not accepted');
});

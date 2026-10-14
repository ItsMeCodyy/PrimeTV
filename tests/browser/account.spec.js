import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../fixtures/trending.json',import.meta.url),'utf8'));
const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
test('account login, profile creation, cloud saves, restoration and signout use Supabase',async({page})=>{
 let profiles=[],activity=[];const calls=[];
 await page.route('**/config.js',async route=>{
  const response=await route.fetch();let body=await response.text();
  body=body.replace(/supabaseUrl: ["']["']/,"supabaseUrl: 'https://primetv-test.supabase.co'").replace(/supabasePublishableKey: ["']["']/,"supabasePublishableKey: 'sb_publishable_test'");
  await route.fulfill({response,body});
 });
 await page.route('**/api.themoviedb.org/3/**',route=>route.fulfill({json:route.request().url().includes('/genre/')?{genres:[]}:{results:fixture.results}}));
 await page.route('https://primetv-test.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url());calls.push({path:url.pathname,method:req.method()});
  if(req.method()==='OPTIONS')return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
  if(url.pathname==='/auth/v1/token'){
   const payload=Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'})).toString('base64url');
   return route.fulfill({json:{access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test`,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,user}});
  }
  if(url.pathname==='/auth/v1/user')return route.fulfill({json:user});
  if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}});
  if(url.pathname.endsWith('primetv_profiles')){
   if(req.method()==='POST'){const data=req.postDataJSON();profiles=[data];return route.fulfill({json:data});}
   return route.fulfill({json:profiles});
  }
  if(url.pathname.endsWith('primetv_activity')){
   if(req.method()==='POST'){activity=req.postDataJSON();return route.fulfill({json:activity});}
   return route.fulfill({json:activity});
  }
  return route.fulfill({json:{}});
 });
 await page.goto('/');await expect(page.locator('.hero')).toBeVisible();
 await page.getByRole('button',{name:/Sign in/}).first().click();
 await page.getByRole('textbox',{name:'Email address'}).fill('test@example.com');
 await page.getByLabel('Password',{exact:true}).fill('example-password');
 await page.locator('#auth-form [type=submit]').click();
 await expect(page.getByRole('heading',{name:'Who’s watching?'})).toBeVisible();
 await page.getByRole('button',{name:'Add profile',exact:true}).click();
 await page.getByRole('textbox',{name:'Profile name'}).fill('Codi');
 await page.getByRole('button',{name:'Save profile'}).click();
 await page.locator('.profile-tile').filter({hasText:'Codi'}).click();
 await page.locator('.hero [data-action=details]').click();
 await page.getByRole('button',{name:'Add to My list',exact:true}).click();
 await expect.poll(()=>activity.length).toBe(1);
 expect(activity[0].user_id).toBe(user.id);expect(activity[0].profile_id).toBe(profiles[0].id);
 await page.getByRole('button',{name:'Close details'}).click();
 // Remove the local history cache so restoration must come from the mock Data API.
 await page.evaluate(()=>{Object.keys(localStorage).filter(k=>k.startsWith('primetv:v2:')).forEach(k=>localStorage.removeItem(k));});
 await page.reload();await expect(page.getByRole('heading',{name:'Who’s watching?'})).toBeVisible();
 await page.locator('.profile-tile').filter({hasText:'Codi'}).click();
 await page.getByRole('button',{name:'My list',exact:true}).click();
 await expect(page.locator('.grid .title-card')).toHaveCount(1);
 await page.locator('#account-button').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.locator('#account-button')).toContainText('Sign in');
 expect(calls.some(c=>c.path==='/auth/v1/logout')).toBe(true);
});

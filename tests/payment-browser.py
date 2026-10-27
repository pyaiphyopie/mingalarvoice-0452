import asyncio, json
from playwright.async_api import async_playwright

# UI fixtures only; backend settlement/security are tested against isolated SQLite.
# No real orders, owner credentials, merchant transfers or credit grants.
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width':390, 'height':844})
        order = None
        async def rpc(route):
            nonlocal order
            endpoint = route.request.url.split('/api/rpc/')[1].split('?')[0]
            body = route.request.post_data_json or {}
            data = body.get('json', body)
            if endpoint == 'owner/status': result = {'eligible': True}
            elif endpoint == 'paymentOrders/list': result = [order] if order else []
            elif endpoint == 'paymentOrders/create':
                order = {'id':'11111111-1111-4111-8111-111111111111', 'userId':'fixture', 'plan':'Creator', 'amount':25000, 'credits':6300, 'currency':'MMK', 'status':'pending_payment', 'method':'KBZPay', 'reference':None, 'createdAt':1, 'submittedAt':None, 'reviewedAt':None, 'reviewedBy':None, 'rejectionReason':None, 'approvalId':None}
                result = order
            elif endpoint == 'paymentOrders/submit':
                order = {**order, 'status':'pending_review', 'reference':data['reference']}; result = order
            elif endpoint == 'owner/pendingOrders': result = [{'order':order, 'customerEmail':'fixture@example.invalid'}] if order and order['status'] == 'pending_review' else []
            elif endpoint == 'owner/approve':
                order = {**order, 'status':'approved'}
                result = {'duplicate':False, 'approval':{'credits':6300, 'periodEnd':1900000000000}}
            else:
                await route.continue_(); return
            await route.fulfill(json={'json':result})
        await page.route('**/api/rpc/**', rpc)
        async def session(route):
            await route.fulfill(json={'user':{'id':'fixture','name':'Fixture','email':'fixture@example.invalid','emailVerified':True,'createdAt':'2026-10-01T00:00:00.000Z','updatedAt':'2026-10-01T00:00:00.000Z'},'session':{'id':'fixture-session','userId':'fixture','token':'fixture-not-a-real-token','expiresAt':'2030-01-01T00:00:00.000Z','createdAt':'2026-10-01T00:00:00.000Z','updatedAt':'2026-10-01T00:00:00.000Z'}})
        await page.route('**/api/auth/get-session*', session)
        await page.goto('http://localhost:4200/billing')
        await page.get_by_role('button', name='Buy Creator', exact=True).click()
        await page.get_by_role('button', name='Create pending KBZPay order', exact=True).click()
        await page.get_by_role('textbox', name='KBZPay transaction reference').fill('FIXTURE001')
        await page.get_by_role('button', name='I have paid — submit for review', exact=True).click()
        await page.get_by_text('Your transfer is awaiting owner verification.', exact=False).wait_for()
        assert await page.locator('dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth')
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        await page.screenshot(path='/home/user/mingalar-payment-mobile.png', full_page=True)
        await page.get_by_role('button', name='Close payment instructions').click()
        await page.goto('http://localhost:4200/account')
        await page.get_by_role('textbox', name='Owner approval passphrase').fill('ui-fixture-not-real-secret-12345')
        await page.get_by_role('button', name='Load pending payment orders', exact=True).click()
        await page.get_by_role('button', name='Select for review', exact=True).click()
        assert await page.get_by_role('textbox', name='Owner approval passphrase').input_value() == ''
        assert await page.get_by_role('textbox', name='Customer account email').input_value() == 'fixture@example.invalid'
        await page.get_by_role('textbox', name='Owner approval passphrase').fill('ui-fixture-not-real-secret-12345')
        await page.get_by_role('checkbox', name='Settled amount verified').check()
        await page.get_by_role('button', name='Approve payment & grant 30-day access', exact=True).click()
        await page.get_by_text('Approved 6,300 credits.', exact=False).wait_for()
        assert await page.get_by_role('textbox', name='Owner approval passphrase').input_value() == ''
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        await page.goto('http://localhost:4200/billing')
        await page.get_by_text('6,300 credits granted', exact=True).wait_for()
        await page.get_by_role('button', name='Buy Creator', exact=True).click()
        await page.get_by_role('button', name='Create pending KBZPay order', exact=True).wait_for()
        print(json.dumps({'fixture_customer_submission':True,'fixture_owner_queue_approval':True,'secret_field_cleared':True,'approved_order_not_reused':True,'mobile_payment_no_overflow':True,'real_payment_actions':False}))
        await browser.close()

asyncio.run(main())
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import Redis from "ioredis";

dotenv.config();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
const corsOrigins = (process.env.CORS_ORIGINS || "").split(",").map(s=>s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));

const mongo = new MongoClient(process.env.MONGO_URI || "mongodb://mongo:27017/autocrm");
await mongo.connect();
const db = mongo.db();
const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379/0");

const JWT_SECRET = process.env.JWT_SECRET || "dev";
function signToken(user){ return jwt.sign({ sub:user._id?.toString?.(), tenantId:user.tenantId, role:user.role, email:user.email }, JWT_SECRET, { expiresIn:"12h" }); }
function auth(required=true){ return async (req,res,next)=>{ const a=req.headers.authorization||""; const t=a.startsWith("Bearer ")?a.slice(7):null; if(!t){ if(required) return res.status(401).json({error:"Missing token"}); req.user=null; return next(); } try{ req.user=jwt.verify(t, JWT_SECRET); next(); } catch{ if(required) return res.status(401).json({error:"Invalid token"}); req.user=null; next(); } } }
const coll = (name, tenantId)=> db.collection(`${tenantId}_${name}`);
const tenants = ()=> db.collection("tenants");
const users = ()=> db.collection("users");

async function hash(p){ return bcrypt.hash(p,10); }
function render(tpl, data){ return (tpl||"").replace(/\{\{(\w+)\}\}/g, (_,k)=> data[k] ?? ""); }
async function mailer(){ const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env; const port = Number(process.env.SMTP_PORT||587); if(!SMTP_HOST||!SMTP_USER||!SMTP_PASS) return null; return nodemailer.createTransport({ host:SMTP_HOST, port, secure: port===465, auth:{ user:SMTP_USER, pass:SMTP_PASS } }); }
async function emitEvent(tenantId, type, data){ await redis.rpush("events", JSON.stringify({ tenantId, type, data, at: Date.now() })); }

app.get("/api/health", (_,res)=> res.json({ ok:true, time:new Date().toISOString() }));

app.post("/api/tenants/provision", async (req,res)=>{
  const { company, email, password } = req.body || {};
  if(!company||!email||!password) return res.status(400).json({error:"company, email, password required"});
  const tenantId = (company||"tenant").toLowerCase().replace(/[^a-z0-9]+/g,"-")+"-"+Date.now().toString(36).slice(-4);
  const exists = await tenants().findOne({ primaryEmail: email });
  if(exists) return res.status(409).json({error:"Email already has a tenant"});
  await tenants().insertOne({ tenantId, company, primaryEmail: email, plan:"trial", createdAt: new Date() });
  const pwd = await hash(password);
  const u = await users().insertOne({ tenantId, email, password: pwd, role:"admin", createdAt: new Date() });
  await seedDemoData(tenantId, email);
  res.json({ tenantId, token: signToken({ _id:u.insertedId, tenantId, role:"admin", email }) });
});

app.post("/api/auth/login", async (req,res)=>{
  const { email, password } = req.body || {};
  const u = await users().findOne({ email });
  if(!u) return res.status(401).json({error:"Invalid credentials"});
  const ok = await bcrypt.compare(password||"", u.password||"");
  if(!ok) return res.status(401).json({error:"Invalid credentials"});
  res.json({ token: signToken(u), tenantId: u.tenantId, role: u.role });
});

app.get("/api/contacts", auth(), async (req,res)=> res.json(await coll("contacts", req.user.tenantId).find({}).limit(500).toArray()));
app.post("/api/contacts", auth(), async (req,res)=>{ await coll("contacts", req.user.tenantId).insertOne({ ...req.body, createdAt:new Date() }); await emitEvent(req.user.tenantId,"contact.created",req.body); res.json({ok:true}); });
app.get("/api/deals", auth(), async (req,res)=> res.json(await coll("deals", req.user.tenantId).find({}).toArray()));
app.post("/api/deals", auth(), async (req,res)=>{ await coll("deals", req.user.tenantId).insertOne({ ...req.body, createdAt:new Date() }); res.json({ok:true}); });

app.get("/api/workflows", auth(), async (req,res)=> res.json(await coll("workflows", req.user.tenantId).find({}).toArray()));
app.post("/api/workflows", auth(), async (req,res)=>{ await coll("workflows", req.user.tenantId).insertOne({ ...req.body, active:true, createdAt:new Date() }); res.json({ok:true}); });

app.post("/api/public/lead", async (req,res)=>{
  const { firstName, email, tenantId } = req.body || {};
  if(!firstName || !email) return res.status(400).json({error:"firstName and email required"});
  const t = tenantId || (process.env.PUBLIC_TENANT_ID||"demo");
  await coll("contacts", t).insertOne({ firstName, email, stage:"Lead", tags:["lead","landing"], createdAt:new Date() });
  await emitEvent(t, "contact.created", { firstName, email });
  res.json({ ok:true, tenantId: t });
});

app.post("/api/demo/reset", auth(), async (req,res)=>{
  if(req.user.email != (process.env.DEMO_ADMIN_EMAIL||"admin@autocrm.cloud")) return res.status(403).json({error:"admin only"});
  const t = await tenants().findOne({ company:"Demo Tenant" });
  if(!t) return res.json({ ok:true, note:"no demo tenant" });
  await resetDemo(t.tenantId);
  res.json({ ok:true });
});

cron.schedule("*/2 * * * *", async ()=>{
  try { while(true){ const payload = await redis.lpop("events"); if(!payload) break;
    const ev = JSON.parse(payload);
    const active = await coll("workflows", ev.tenantId).find({ "when.event": ev.type, active:true }).toArray();
    for(const wf of active){ await execWorkflow(wf, ev); }
  }} catch(e){ console.error("[workflow loop]", e.message); }
});

async function seedDemoData(tenantId, email){
  await coll("contacts", tenantId).insertMany([
    { firstName:"Alicia", lastName:"Patel", email:"alicia@example.com", stage:"Lead", createdAt:new Date() },
    { firstName:"Rohit", lastName:"Verma", email:"rohit@example.com", stage:"MQL", createdAt:new Date() },
    { firstName:"Sara", lastName:"Khan", email:"sara@example.com", stage:"SQL", createdAt:new Date() }
  ]);
  await coll("deals", tenantId).insertMany([
    { name:"AutoCRM Pilot - DemoCorp", amount:1200, stage:"Qualified", createdAt:new Date() },
    { name:"Onboarding - RetailPro", amount:3000, stage:"Proposal", createdAt:new Date() }
  ]);
  await coll("workflows", tenantId).insertOne({
    name:"Welcome new lead",
    when:{ event:"contact.created" },
    then:[ { action:"email", subject:"Welcome to AutoCRM", body:"Hi {{firstName}}, thanks for joining AutoCRM!" } ],
    active:true, createdAt:new Date()
  });
  await emitEvent(tenantId, "contact.created", { firstName:"Sample", email:"sample@autocrm.cloud" });
}

async function resetDemo(tenantId){
  for(const c of ["contacts","deals","workflows"]){ await coll(c, tenantId).deleteMany({}); }
  await seedDemoData(tenantId, process.env.DEMO_ADMIN_EMAIL||"admin@autocrm.cloud");
}

async function execWorkflow(wf, ev){
  const t = await mailer(); if(!t){ console.log("[workflow] SMTP not configured; skipping email"); return; }
  for(const step of wf.then||[]){
    if(step.action==="email"){
      const to = ev.data.email;
      const firstName = ev.data.firstName || "there";
      const subject = render(step.subject||"AutoCRM", { firstName });
      const html = render(step.body||"Hi {{firstName}}", { firstName });
      try {
        await t.sendMail({ from:`"${process.env.SMTP_FROM_NAME||'AutoCRM'}" <${process.env.SMTP_FROM_EMAIL||'noreply@example.com'}>`, to, subject, html });
      } catch(e){ console.error("[email]", e.message); }
    }
  }
}

(async ()=>{
  const demo = await tenants().findOne({ company:"Demo Tenant" });
  if(!demo){
    const id = "demo-"+Date.now().toString(36);
    await tenants().insertOne({ tenantId:id, company:"Demo Tenant", primaryEmail: process.env.DEMO_ADMIN_EMAIL||"admin@autocrm.cloud", plan:"demo", createdAt:new Date() });
    const pwd = await hash(process.env.DEMO_ADMIN_PASSWORD||"admin123");
    await users().insertOne({ tenantId:id, email: process.env.DEMO_ADMIN_EMAIL||"admin@autocrm.cloud", password: pwd, role:"admin", createdAt: new Date() });
    await seedDemoData(id, process.env.DEMO_ADMIN_EMAIL||"admin@autocrm.cloud");
    console.log("Demo tenant created:", id);
  }
})();

const port = Number(process.env.PORT||4000);
app.listen(port, ()=> console.log("API on", port));

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const API = (path)=> fetch(`/api${path}`, { headers: authHeader() });
const POST = (path, body)=> fetch(`/api${path}`, {
  method:"POST", headers: { "Content-Type":"application/json", ...authHeader() }, body: JSON.stringify(body)
});
function authHeader(){ const t=localStorage.getItem("token"); return t?{Authorization:`Bearer ${t}`}:{ }; }

function App(){
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [tenantId, setTenantId] = useState(localStorage.getItem("tenantId"));
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [contacts, setContacts] = useState([]); const [deals, setDeals] = useState([]); const [workflows, setWorkflows] = useState([]);

  useEffect(()=>{ if(token) load(); }, [token]);
  async function load(){
    setContacts(await (await API("/contacts")).json());
    setDeals(await (await API("/deals")).json());
    setWorkflows(await (await API("/workflows")).json());
  }
  async function login(e){
    e.preventDefault();
    const res = await fetch("/api/auth/login", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ email, password })});
    const data = await res.json();
    if(data.token){ localStorage.setItem("token",data.token); localStorage.setItem("tenantId",data.tenantId); setToken(data.token); setTenantId(data.tenantId); } else alert(data.error||"Login failed");
  }
  async function addContact(){ const firstName=prompt("First name?"); const email=prompt("Email?"); if(!firstName||!email) return; await POST("/contacts",{ firstName,email,stage:"Lead" }); await load(); }
  async function addDeal(){ const name=prompt("Deal name?"); const amount=Number(prompt("Amount?")||0); await POST("/deals",{ name,amount,stage:"Qualified" }); await load(); }
  async function newWorkflow(){ const subject=prompt("Email subject for new-lead workflow?","Welcome to AutoCRM"); await POST("/workflows",{ name:"Welcome new lead", when:{event:"contact.created"}, then:[{action:"email", subject, body:"Hi {{firstName}}, welcome!"}] }); await load(); }

  if(!token){
    return (<div><div className="nav"><img src="/logo.svg"/><b>AutoCRM</b><span className="pill">Demo</span></div>
      <div style={{maxWidth:420, margin:"60px auto"}} className="card">
        <h2>Login to AutoCRM</h2>
        <form onSubmit={login} className="col">
          <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          <button className="btn">Login</button>
          <p style={{opacity:.7}}>Demo admin: <code>admin@autocrm.cloud / admin123</code></p>
        </form>
      </div></div>);
  }

  return (<div>
    <div className="nav"><img src="/logo.svg"/><b>AutoCRM</b><span style={{marginLeft:"auto"}}>{tenantId}</span>
      <button className="btn" style={{marginLeft:12}} onClick={()=>{localStorage.clear(); location.reload();}}>Logout</button></div>
    <div style={{maxWidth:1100, margin:"20px auto"}} className="grid">
      <div className="card"><h3>Contacts</h3><button className="btn" onClick={addContact}>+ Add Contact</button>
        <ul>{contacts.map((c,i)=>(<li key={i}>{c.firstName} — {c.email} <span className="pill">{c.stage}</span></li>))}</ul></div>
      <div className="card"><h3>Deals</h3><button className="btn" onClick={addDeal}>+ Add Deal</button>
        <ul>{deals.map((d,i)=>(<li key={i}>{d.name} — ${d.amount} <span className="pill">{d.stage}</span></li>))}</ul></div>
      <div className="card"><h3>Workflows</h3><button className="btn" onClick={newWorkflow}>+ New Workflow</button>
        <ul>{workflows.map((w,i)=>(<li key={i}><b>{w.name}</b> — trigger: {w.when?.event}</li>))}</ul>
        <p style={{opacity:.7}}>Emails send if SMTP is configured in <code>.env</code>.</p></div>
      <div className="card"><h3>Demo Reset</h3>
        <button className="btn" onClick={async ()=>{ await POST("/demo/reset",{}); alert("Demo reset triggered."); }}>Reset Demo (admin only)</button>
      </div>
    </div></div>);
}
createRoot(document.getElementById("root")).render(<App/>);

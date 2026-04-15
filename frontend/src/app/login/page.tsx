"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulate auth delay
    setTimeout(() => {
      router.push('/');
    }, 600);
  };

  return (
    <div className="flex h-screen w-full items-center justify-center p-6 bg-background">
      <div className="w-full max-w-[420px] bg-card rounded-3xl shadow-apple border border-border p-10 flex flex-col items-center relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[100px] bg-apple-blue/10 blur-[60px] rounded-full pointer-events-none"></div>
        
        <div className="w-14 h-14 bg-black/5 rounded-2xl flex items-center justify-center mb-6 z-10 border border-border">
          <span className="text-[22px] font-bold tracking-tighter text-foreground">AI</span>
        </div>
        
        <h1 className="text-[24px] font-semibold tracking-tight mb-2 text-center text-foreground z-10">Sign in to Factory</h1>
        <p className="text-[15px] text-apple-gray text-center mb-8 z-10">Use your Admin credentials to continue.</p>

        <form className="w-full space-y-4 z-10" onSubmit={handleLogin}>
          <div>
            <input 
              type="text" 
              placeholder="Email or Workspace ID"
              className="w-full bg-black/[0.03] border border-transparent rounded-xl px-4 py-3.5 text-[15px] focus:outline-none focus:bg-white focus:shadow-sm focus:border-apple-blue/30 focus:ring-2 focus:ring-apple-blue/20 transition-all text-foreground placeholder:text-apple-gray"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <input 
              type="password" 
              placeholder="Password"
              className="w-full bg-black/[0.03] border border-transparent rounded-xl px-4 py-3.5 text-[15px] focus:outline-none focus:bg-white focus:shadow-sm focus:border-apple-blue/30 focus:ring-2 focus:ring-apple-blue/20 transition-all text-foreground placeholder:text-apple-gray"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          <div className="pt-4">
            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-apple-blue text-white rounded-xl px-4 py-3.5 text-[15px] font-medium hover:bg-apple-blue/90 active:scale-[0.98] transition-all shadow-sm flex items-center justify-center gap-2 group disabled:opacity-70"
            >
              {loading ? "Signing In..." : "Continue"} {!loading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>
        </form>
        
      </div>
    </div>
  );
}

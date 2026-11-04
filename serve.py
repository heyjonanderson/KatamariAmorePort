# Static server for the Katamari viewer. Default port 8791, or pass one: serve.py 9000. If busy, tries the next 20 ports.
import http.server, socketserver, os, socket, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = False   # on Windows, True would let two servers share a port
    daemon_threads = True
def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); ip = s.getsockname()[0]; s.close(); return ip
    except Exception: return 'YOUR-PC-IP'
def all_ips():
    ips = []
    try:
        for r in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = r[4][0]
            if not ip.startswith('127.') and not ip.startswith('169.254.') and ip not in ips: ips.append(ip)
    except Exception: pass
    p = lan_ip()
    if p not in ips and p != 'YOUR-PC-IP': ips.insert(0, p)
    return ips
start = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('KATAMARI_PORT', 8791))
srv = None
for port in range(start, start + 21):
    try: srv = S(('0.0.0.0', port), H); break
    except OSError: print(f'port {port} is busy, trying the next one', flush=True)
if not srv: sys.exit('no free port found')
print(f'Katamari game:  http://localhost:{port}/game.html', flush=True)
print('On your phone (same wifi), try each of these until one loads:', flush=True)
for ip in (all_ips() or ['YOUR-PC-IP']): print(f'    http://{ip}:{port}/game.html', flush=True)
print('If none load: Windows Firewall is probably blocking Python. Allow it for Private networks when asked, or in an admin PowerShell run:', flush=True)
print(f'    New-NetFirewallRule -DisplayName "Katamari port" -Direction Inbound -Protocol TCP -LocalPort {port} -Action Allow -Profile Private', flush=True)
srv.serve_forever()

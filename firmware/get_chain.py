from OpenSSL import SSL, crypto
import socket

hostname = 'smarta-api.smarta-api.workers.dev'
port = 443

ctx = SSL.Context(SSL.TLS_METHOD)
ctx.set_verify(SSL.VERIFY_NONE, lambda *a: True)
conn = SSL.Connection(ctx, socket.create_connection((hostname, port)))
conn.set_tlsext_host_name(hostname.encode())
conn.set_connect_state()
conn.do_handshake()

chain = conn.get_peer_cert_chain()
for i, cert in enumerate(chain):
    pem = crypto.dump_certificate(crypto.FILETYPE_PEM, cert)
    fname = f'cert{i}.pem'
    with open(fname, 'wb') as f:
        f.write(pem)
    print(f'{fname}: {cert.get_subject().CN}')

conn.close()
print(f'\nסה"כ {len(chain)} certs. Root CA = cert{len(chain)-1}.pem')

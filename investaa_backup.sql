--
-- PostgreSQL database dump
--

\restrict NNGN6vDqtXWzm2ccG5c5xFMdDwMCxZnb8p3lAOPHqTJsOZbAIEodF2xccZaa5Cv

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text
);


--
-- Name: deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deposits (
    id integer NOT NULL,
    user_id integer NOT NULL,
    amount numeric NOT NULL,
    network text,
    txid text,
    proof_path text,
    status text DEFAULT 'PENDING'::text,
    usdt_amount numeric,
    crypto_amount numeric,
    exchange_rate numeric,
    screenshot text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: deposits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deposits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deposits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deposits_id_seq OWNED BY public.deposits.id;


--
-- Name: kyc_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_submissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    country text NOT NULL,
    id_type text NOT NULL,
    id_number text NOT NULL,
    id_document text,
    id_document_back text,
    selfie text,
    extra_field_name text,
    extra_field_value text,
    status text DEFAULT 'PENDING'::text,
    rejection_reason text,
    submitted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reviewed_at timestamp without time zone,
    extra_document text
);


--
-- Name: kyc_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kyc_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kyc_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kyc_submissions_id_seq OWNED BY public.kyc_submissions.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    type text DEFAULT 'SYSTEM'::text,
    status text DEFAULT 'SYSTEM'::text,
    is_read integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: outreach_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_campaigns (
    id integer NOT NULL,
    subject text NOT NULL,
    total integer DEFAULT 0,
    sent integer DEFAULT 0,
    failed integer DEFAULT 0,
    suppressed integer DEFAULT 0,
    status text DEFAULT 'RUNNING'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    recipients text,
    daily_limit integer DEFAULT 200,
    bonus_amount numeric(18,2) DEFAULT 0,
    body text
);


--
-- Name: outreach_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outreach_campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outreach_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outreach_campaigns_id_seq OWNED BY public.outreach_campaigns.id;


--
-- Name: outreach_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_suppressions (
    id integer NOT NULL,
    email text NOT NULL,
    reason text DEFAULT 'unsubscribe'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: outreach_suppressions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outreach_suppressions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outreach_suppressions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outreach_suppressions_id_seq OWNED BY public.outreach_suppressions.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type text NOT NULL,
    amount numeric NOT NULL,
    details text,
    status text DEFAULT 'COMPLETED'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    pin text NOT NULL,
    phone text DEFAULT ''::text,
    country text DEFAULT 'United States'::text,
    balance numeric DEFAULT 0,
    deposit_balance numeric DEFAULT 0,
    vip_rank text DEFAULT 'REGULAR'::text,
    is_admin integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_earning_at timestamp without time zone,
    email_verified integer DEFAULT 0,
    verification_code text,
    verification_expires timestamp without time zone,
    full_name text DEFAULT ''::text,
    address text DEFAULT ''::text,
    gender text DEFAULT ''::text,
    date_of_birth date,
    pending_email text,
    pending_email_code text,
    pending_email_expires timestamp without time zone,
    last_login timestamp without time zone,
    last_reminder_sent timestamp without time zone,
    kyc_status text DEFAULT 'NONE'::text,
    is_banned integer DEFAULT 0,
    bonus_balance numeric DEFAULT 0,
    email_invalid integer DEFAULT 0
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withdrawals (
    id integer NOT NULL,
    user_id integer NOT NULL,
    amount numeric NOT NULL,
    details text,
    status text DEFAULT 'PENDING'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: withdrawals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.withdrawals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: withdrawals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.withdrawals_id_seq OWNED BY public.withdrawals.id;


--
-- Name: deposits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits ALTER COLUMN id SET DEFAULT nextval('public.deposits_id_seq'::regclass);


--
-- Name: kyc_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_submissions ALTER COLUMN id SET DEFAULT nextval('public.kyc_submissions_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: outreach_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_campaigns ALTER COLUMN id SET DEFAULT nextval('public.outreach_campaigns_id_seq'::regclass);


--
-- Name: outreach_suppressions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_suppressions ALTER COLUMN id SET DEFAULT nextval('public.outreach_suppressions_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: withdrawals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals ALTER COLUMN id SET DEFAULT nextval('public.withdrawals_id_seq'::regclass);


--
-- Data for Name: app_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_settings (key, value) FROM stdin;
\.


--
-- Data for Name: deposits; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.deposits (id, user_id, amount, network, txid, proof_path, status, usdt_amount, crypto_amount, exchange_rate, screenshot, created_at) FROM stdin;
\.


--
-- Data for Name: kyc_submissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kyc_submissions (id, user_id, country, id_type, id_number, id_document, id_document_back, selfie, extra_field_name, extra_field_value, status, rejection_reason, submitted_at, reviewed_at, extra_document) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, title, message, type, status, is_read, created_at) FROM stdin;
\.


--
-- Data for Name: outreach_campaigns; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.outreach_campaigns (id, subject, total, sent, failed, suppressed, status, created_at, recipients, daily_limit, bonus_amount, body) FROM stdin;
\.


--
-- Data for Name: outreach_suppressions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.outreach_suppressions (id, email, reason, created_at) FROM stdin;
\.


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.transactions (id, user_id, type, amount, details, status, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, email, password, pin, phone, country, balance, deposit_balance, vip_rank, is_admin, created_at, last_earning_at, email_verified, verification_code, verification_expires, full_name, address, gender, date_of_birth, pending_email, pending_email_code, pending_email_expires, last_login, last_reminder_sent, kyc_status, is_banned, bonus_balance, email_invalid) FROM stdin;
3	emailtest1776547299	lordgbemicharles@gmail.com	$2b$10$dRmYP.Jq6My1yQRixCCf7ejiqZgOW14ANGsxbR3yjLFNrLOELbWxi	$2b$10$dw.aoJC.6GWIEwoRAkcxCe3bFhML6S1mgN0Tmnf7iyBjsycqLZxAW	5555555555	United States	0	0	REGULAR	0	2026-04-18 21:21:39.873678	\N	1	\N	\N				\N	\N	\N	\N	\N	2026-08-07 05:07:55.847682	NONE	0	0	0
1	elonmusk	pupcuby24@gmail.com	$2b$10$kxpJfy3m9hSotUZPrtuBaOTeqs7x03QbH1HdL4mHmAAbQJc6Pv8xi	$2b$10$XsuP5rYwuKpgD/dAfjfzBuEb4ZdAQqjyPUc5aDGXwKp4p47ehAyOa	+1+19015421486	United States	0	0	REGULAR	0	2026-04-18 21:18:13.932695	\N	1	\N	\N				\N	\N	\N	\N	2026-06-21 21:03:52.578122	2026-08-07 05:07:57.118252	NONE	0	0	0
2	emailtest1776547173	investaa.pro@gmail.com	$2b$10$nWzpSDDb8dGMUCpQtSF6neA3WW.D0CCwDFFRwZy4nC.aNyAQWhRvu	$2b$10$p0RyU4UU3vr1pzatyXyixOH7Mt3Td6DYgPtNUPCjwJCwzE9p.O4xu	5555555555	United States	0	0	REGULAR	0	2026-04-18 21:19:33.882454	\N	1	\N	\N				\N	\N	\N	\N	\N	2026-08-07 05:07:58.380996	NONE	0	0	0
\.


--
-- Data for Name: withdrawals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.withdrawals (id, user_id, amount, details, status, created_at) FROM stdin;
\.


--
-- Name: deposits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.deposits_id_seq', 1, false);


--
-- Name: kyc_submissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kyc_submissions_id_seq', 1, false);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notifications_id_seq', 1, false);


--
-- Name: outreach_campaigns_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.outreach_campaigns_id_seq', 1, false);


--
-- Name: outreach_suppressions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.outreach_suppressions_id_seq', 1, false);


--
-- Name: transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.transactions_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 3, true);


--
-- Name: withdrawals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.withdrawals_id_seq', 1, false);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: deposits deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_pkey PRIMARY KEY (id);


--
-- Name: kyc_submissions kyc_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_submissions
    ADD CONSTRAINT kyc_submissions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: outreach_campaigns outreach_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_campaigns
    ADD CONSTRAINT outreach_campaigns_pkey PRIMARY KEY (id);


--
-- Name: outreach_suppressions outreach_suppressions_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_suppressions
    ADD CONSTRAINT outreach_suppressions_email_key UNIQUE (email);


--
-- Name: outreach_suppressions outreach_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_suppressions
    ADD CONSTRAINT outreach_suppressions_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: withdrawals withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);


--
-- Name: deposits deposits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: kyc_submissions kyc_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_submissions
    ADD CONSTRAINT kyc_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: withdrawals withdrawals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict NNGN6vDqtXWzm2ccG5c5xFMdDwMCxZnb8p3lAOPHqTJsOZbAIEodF2xccZaa5Cv


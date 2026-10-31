/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  X, 
  ExternalLink, 
  Code2, 
  GraduationCap, 
  MapPin, 
  Sparkles,
  Heart
} from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  accentClasses,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#141822] border border-white/[0.12] rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#11141d] border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1 rounded-md ${accentClasses.bg} text-slate-950`}>
              <Code2 className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">About the Developer</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 text-xs text-slate-300">
          {/* Developer Profile Header */}
          <div className="flex items-center gap-3.5">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-[#1b2230] border border-white/[0.12] flex items-center justify-center text-slate-100 font-bold text-base shadow-inner">
                A
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${accentClasses.bg} border-2 border-[#141822] flex items-center justify-center`}>
                <span className="w-1 h-1 rounded-full bg-slate-950" />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-100">Asif</h4>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                <span>Developer</span>
                <span className="text-slate-400">·</span>
                <span>26 years old</span>
                <span className="text-slate-400">·</span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-2.5 h-2.5 text-slate-400" />
                  <span>Bangladesh</span>
                </span>
              </div>
            </div>
          </div>

          {/* Bio Description */}
          <div className="space-y-3 leading-relaxed text-[12px] text-slate-300">
            <p>
              Hi, I'm Asif, a 26-year-old developer and technology enthusiast from Bangladesh. I graduated in 2023 with a Bachelor of Business Studies (BBS) from Chandpur Government College. I'm passionate about technology, software development, digital creativity, and building useful applications with clean design and a great user experience.
            </p>
            <p className="text-slate-400">
              I created this application to provide a simple, efficient, and ad-free experience without unnecessary bloatware.
            </p>
          </div>

          {/* Education & Focus Info Card */}
          <div className="p-3 bg-[#0d1016] border border-white/[0.06] rounded-lg space-y-2 text-[11px] font-mono text-slate-400">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Education:</span>
              <span className="text-slate-200">BBS (2023) · Chandpur Govt. College</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Philosophy:</span>
              <span className="text-slate-200">Zero bloatware · Local-first privacy</span>
            </div>
          </div>

          {/* Social Links */}
          <div className="pt-1 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Connect & Follow:</span>
            <a
              href="https://www.instagram.com/artyasif19/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 text-slate-200 hover:text-white transition-all text-xs font-medium"
            >
              <svg className="w-3.5 h-3.5 text-pink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
              </svg>
              <span>@artyasif19</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#11141d] border-t border-white/[0.08] flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span>NOVA Download Manager</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1 text-xs font-semibold bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
